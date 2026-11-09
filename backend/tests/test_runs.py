"""End-to-end: API → outbox → bus → worker → LangGraph agents → outbox → bus → projector → read models."""

import asyncio

from sqlalchemy import func, select

from app.agents.schemas import PlannedAction
from app.database.session import session_scope
from app.models import ExecutionEvent, ProcessedEvent
from tests.conftest import hdr, upload_text, wait_run

DOC = """The NEXUS pilot reduced report preparation time from 6 hours to 40 minutes across 12 teams.
Adoption was highest in finance, where 9 of 10 analysts used it weekly. The main complaint was slow PDF parsing."""


async def _workflow(client, auth, name: str) -> dict:
    wfs = (await client.get("/api/v1/workflows", headers=hdr(auth))).json()
    return next(w for w in wfs if w["name"] == name)


async def test_research_brief_runs_with_rag_and_persisted_logs(client, auth, llm):
    await upload_text(client, auth, "pilot.txt", DOC)
    wf = await _workflow(client, auth, "Research brief")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Summarise the pilot results and adoption"})
    assert r.status_code == 202
    run = await wait_run(client, auth, r.json()["id"])
    assert run["status"] == "succeeded", run.get("error")

    # agents collaborated in order, each step persisted with output and timing
    types = [s["agent_type"] for s in run["steps"]]
    assert types == ["research", "analyst", "reviewer"]
    assert all(s["status"] == "succeeded" and s["duration_ms"] is not None for s in run["steps"])

    # research used the knowledge base and cited it
    research = run["steps"][0]
    assert research["tools"][0]["tool"] == "kb_search"
    assert research["output"]["sources"][0]["filename"] == "pilot.txt"
    assert 1 in research["output"]["cited"]
    assert run["output"]["sources"] and run["output"]["review"]["verdict"] == "approve"
    assert run["tokens_in"] > 0

    # the full lifecycle went through the bus and was persisted in order
    events = (await client.get(f"/api/v1/runs/{run['id']}/events", headers=hdr(auth))).json()
    kinds = [e["type"] for e in events]
    assert kinds[0] == "workflow.started" and kinds[-1] == "workflow.completed"
    assert kinds.count("agent.started") == 3 and kinds.count("agent.completed") == 3
    assert "tool.called" in kinds
    assert [e["seq"] for e in events] == sorted(e["seq"] for e in events)


async def test_reviewer_revision_loop_is_capped(client, auth, llm):
    llm.verdicts.extend(["revise", "revise", "revise", "revise"])
    wf = await _workflow(client, auth, "Research brief")  # reviewer maxRevisions = 2
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Analyse the topic in depth"})
    run = await wait_run(client, auth, r.json()["id"])
    assert run["status"] == "succeeded"
    reviews = [s for s in run["steps"] if s["agent_type"] == "reviewer"]
    analysts = [s for s in run["steps"] if s["agent_type"] == "analyst"]
    assert len(reviews) == 3  # initial review + 2 revisions, then the cap stops the loop
    assert [a["iteration"] for a in analysts] == [1, 2, 3]
    assert run["output"]["review"]["revision_cap_reached"] is True
    events = (await client.get(f"/api/v1/runs/{run['id']}/events", headers=hdr(auth))).json()
    assert sum(e["type"] == "review.revision_requested" for e in events) == 2


async def test_transient_failure_is_retried(client, auth, llm):
    llm.fail_next = 1
    wf = await _workflow(client, auth, "Research brief")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Retry behaviour check"})
    run = await wait_run(client, auth, r.json()["id"])
    assert run["status"] == "succeeded"
    first = [s for s in run["steps"] if s["node_id"] == "research"]
    assert [s["status"] for s in first] == ["failed", "succeeded"]
    assert first[1]["attempt"] == 2


async def test_destructive_action_waits_for_approval(client, auth, llm):
    await upload_text(client, auth, "obsolete.txt", "This obsolete policy document should be removed from the knowledge base.")
    llm.exec_actions = [
        PlannedAction(tool="save_report", args_json='{"title": "Cleanup report", "content": "# Report\\nDone."}', reason="Record"),
        PlannedAction(tool="delete_document", args_json='{"filename": "obsolete.txt"}', reason="Obsolete"),
    ]
    wf = await _workflow(client, auth, "Analyze & act")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Clean up obsolete documents"})
    run = await wait_run(client, auth, r.json()["id"])
    assert run["status"] == "awaiting_approval"
    approval = run["approvals"][0]
    assert approval["status"] == "pending"
    assert [a["tool"] for a in approval["actions"]] == ["delete_document"]
    # nothing destructive happened yet
    docs = (await client.get("/api/v1/documents", headers=hdr(auth))).json()
    assert any(d["filename"] == "obsolete.txt" for d in docs)

    d = await client.post(f"/api/v1/approvals/{approval['id']}/decision", headers=hdr(auth), json={"approve": True})
    assert d.status_code == 200
    run = await wait_run(client, auth, run["id"], statuses=("succeeded", "failed"))
    assert run["status"] == "succeeded", run.get("error")
    execution = next(s for s in run["steps"] if s["agent_type"] == "execution")
    statuses = {a["tool"]: a["status"] for a in execution["output"]["actions"]}
    assert statuses == {"save_report": "done", "delete_document": "done"}
    assert run["artifacts"][0]["title"] == "Cleanup report"
    docs = (await client.get("/api/v1/documents", headers=hdr(auth))).json()
    assert not any(d["filename"] == "obsolete.txt" for d in docs)


async def test_rejected_action_is_not_executed(client, auth, llm):
    await upload_text(client, auth, "keep.txt", "Keep this document in the knowledge base forever.")
    llm.exec_actions = [PlannedAction(tool="delete_document", args_json='{"filename": "keep.txt"}', reason="Test")]
    wf = await _workflow(client, auth, "Analyze & act")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Try to delete"})
    run = await wait_run(client, auth, r.json()["id"])
    await client.post(f"/api/v1/approvals/{run['approvals'][0]['id']}/decision", headers=hdr(auth), json={"approve": False})
    run = await wait_run(client, auth, run["id"], statuses=("succeeded", "failed"))
    execution = next(s for s in run["steps"] if s["agent_type"] == "execution")
    assert execution["output"]["actions"][0]["status"] == "rejected"
    docs = (await client.get("/api/v1/documents", headers=hdr(auth))).json()
    assert any(d["filename"] == "keep.txt" for d in docs)


async def test_parallel_branches_join(client, auth, llm):
    wf = await _workflow(client, auth, "Two-angle comparison")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Compare two approaches"})
    run = await wait_run(client, auth, r.json()["id"])
    assert run["status"] == "succeeded"
    order = [s["node_id"] for s in run["steps"]]
    assert set(order[:2]) == {"r_a", "r_b"} and order[2:] == ["analyst", "reviewer"]


async def test_cancel_mid_run(client, auth, llm):
    llm.delay = 0.4
    wf = await _workflow(client, auth, "Research brief")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Cancel me"})
    run_id = r.json()["id"]
    await wait_run(client, auth, run_id, statuses=("running",))
    c = await client.post(f"/api/v1/runs/{run_id}/cancel", headers=hdr(auth))
    assert c.status_code == 202
    run = await wait_run(client, auth, run_id, statuses=("cancelled", "succeeded", "failed"))
    assert run["status"] == "cancelled"
    assert all(s["status"] != "running" for s in run["steps"])


async def test_cancel_while_queued(client, auth, llm):
    wf = await _workflow(client, auth, "Research brief")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Cancel at once"})
    c = await client.post(f"/api/v1/runs/{r.json()['id']}/cancel", headers=hdr(auth))
    assert c.status_code in (202, 409)
    run = await wait_run(client, auth, r.json()["id"], statuses=("cancelled", "succeeded"))
    assert run["status"] in ("cancelled", "succeeded")


async def test_events_are_idempotent(client, auth, llm):
    """Re-delivering an already processed lifecycle event changes nothing (at-least-once safe)."""
    from app.events.envelope import EventEnvelope
    from app.workers.projector import Projector

    wf = await _workflow(client, auth, "Research brief")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Idempotency"})
    run = await wait_run(client, auth, r.json()["id"])
    async with session_scope() as s:
        ev = (await s.execute(select(ExecutionEvent).where(ExecutionEvent.run_id == run["id"]).limit(1))).scalars().first()
        before = (await s.execute(select(func.count()).select_from(ExecutionEvent))).scalar_one()
    env = EventEnvelope(event_id=ev.event_id, type=ev.type, workspace_id=ev.workspace_id, run_id=ev.run_id, seq=ev.seq, payload=ev.payload, occurred_at=ev.occurred_at)
    await Projector()("nexus.lifecycle", env.to_bytes())
    async with session_scope() as s:
        after = (await s.execute(select(func.count()).select_from(ExecutionEvent))).scalar_one()
        ledger = (await s.execute(select(func.count()).select_from(ProcessedEvent).where(ProcessedEvent.event_id == ev.event_id))).scalar_one()
    assert after == before and ledger == 1


async def test_poison_message_goes_to_dead_letter_queue(client, auth):
    from app.database.session import session_scope as ss
    from app.events.consumer import Consumer
    from app.events.envelope import EventEnvelope
    from app.models import DeadLetter

    class Exploding(Consumer):
        name = "test-exploding"
        topics = ["nexus.lifecycle"]
        backoff_base = 0.01

        async def handle(self, envelope, topic, session):
            raise RuntimeError("boom")

    ws = auth["X-Workspace-Id"]
    env = EventEnvelope(type="test.poison", workspace_id=ws)
    await Exploding()("nexus.lifecycle", env.to_bytes())
    async with ss() as s:
        dl = (await s.execute(select(DeadLetter).where(DeadLetter.event_id == env.event_id))).scalars().first()
    assert dl is not None and dl.attempts == 3 and "boom" in dl.error
    pipe = (await client.get("/api/v1/monitoring/pipeline", headers=hdr(auth))).json()
    assert any(d["event_id"] == str(env.event_id) for d in pipe["dead_letters"])


async def test_sse_stream_replays_and_ends(client, auth, llm):
    wf = await _workflow(client, auth, "Research brief")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Stream check"})
    run = await wait_run(client, auth, r.json()["id"])
    async with client.stream("GET", f"/api/v1/runs/{run['id']}/stream", headers=hdr(auth)) as resp:
        text = ""
        async for chunk in resp.aiter_text():
            text += chunk
            if "event: end" in text:
                break
    assert "workflow.started" in text and "workflow.completed" in text
    # resume from the middle with Last-Event-ID
    async with client.stream("GET", f"/api/v1/runs/{run['id']}/stream", headers={**hdr(auth), "Last-Event-ID": "3"}) as resp:
        text2 = ""
        async for chunk in resp.aiter_text():
            text2 += chunk
            if "event: end" in text2:
                break
    assert "id: 1\r\n" not in text2 and "id: 4" in text2


async def test_monitoring_reflects_real_runs(client, auth, llm):
    wf = await _workflow(client, auth, "Research brief")
    for i in range(2):
        r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": f"Metrics run {i}"})
        await wait_run(client, auth, r.json()["id"])
    await asyncio.sleep(2.5)  # consumer stats flush every 2s
    ov = (await client.get("/api/v1/monitoring/overview", headers=hdr(auth))).json()
    assert ov["runs"] == 2 and ov["succeeded"] == 2 and ov["success_rate"] == 1.0
    assert ov["workflows"] == 3
    agents = {a["agent_type"]: a for a in (await client.get("/api/v1/monitoring/agents", headers=hdr(auth))).json()}
    assert agents["research"]["succeeded"] == 2
    pipe = (await client.get("/api/v1/monitoring/pipeline", headers=hdr(auth))).json()
    consumers = {c["consumer"] for c in pipe["consumers"]}
    assert {"nexus-worker", "nexus-projector"} <= consumers


async def test_worker_crash_resumes_from_checkpoint(client, auth, llm, runtime):
    """Kill the task running a workflow mid-flight (no cancel request = simulated worker death),
    expire its lease, and let recovery resume it. Finished steps must not run again."""
    import uuid
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update

    from app.models import WorkflowRun

    llm.delay = 0.3
    wf = await _workflow(client, auth, "Research brief")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Survive a crash"})
    run_id = r.json()["id"]

    async def analyst_running():
        run = (await client.get(f"/api/v1/runs/{run_id}", headers=hdr(auth))).json()
        done = [s for s in run["steps"] if s["node_id"] == "research" and s["status"] == "succeeded"]
        busy = [s for s in run["steps"] if s["node_id"] == "analyst" and s["status"] == "running"]
        return run if done and busy else None

    from tests.conftest import wait_for

    await wait_for(analyst_running)
    task = runtime.executor.tasks[uuid.UUID(run_id)]
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)

    async with session_scope() as s:
        await s.execute(
            update(WorkflowRun).where(WorkflowRun.id == run_id).values(heartbeat_at=datetime.now(UTC) - timedelta(minutes=5))
        )
    llm.delay = 0
    assert await runtime.executor.recover() >= 1

    run = await wait_run(client, auth, run_id, statuses=("succeeded", "failed"))
    assert run["status"] == "succeeded", run.get("error")
    research = [s for s in run["steps"] if s["node_id"] == "research"]
    assert len(research) == 1  # checkpointed work was not redone
    analysts = [s for s in run["steps"] if s["node_id"] == "analyst"]
    assert [a["status"] for a in analysts] == ["failed", "succeeded"]
    assert "Interrupted" in analysts[0]["error"]
    events = (await client.get(f"/api/v1/runs/{run_id}/events", headers=hdr(auth))).json()
    assert any(e["type"] == "workflow.resumed" and "checkpoint" in e["payload"]["reason"] for e in events)


async def test_failed_run_retries_from_checkpoint(client, auth, llm):
    llm.fail_next = 3  # research exhausts its 3 attempts → run fails
    wf = await _workflow(client, auth, "Research brief")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Fail then retry"})
    run = await wait_run(client, auth, r.json()["id"])
    assert run["status"] == "failed" and "Research" in run["error"]
    rr = await client.post(f"/api/v1/runs/{run['id']}/retry", headers=hdr(auth))
    assert rr.status_code == 202
    run = await wait_run(client, auth, run["id"], statuses=("succeeded", "failed"), timeout=40)
    assert run["status"] == "succeeded", run.get("error")
