"""Consumes ``nexus.lifecycle`` and maintains the read models.

* appends every event to ``execution_events`` (the replayable log),
* projects run and step state into ``workflow_runs`` / ``run_steps``,
* fans each event out to the realtime channels after commit (SSE subscribers).
"""

from datetime import datetime
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.events import envelope as ev
from app.events.consumer import Consumer
from app.events.envelope import EventEnvelope
from app.events.pubsub import get_pubsub, run_channel, workspace_channel
from app.models import ExecutionEvent, RunStep, WorkflowRun

log = get_logger(__name__)


def _ms(a: datetime | None, b: datetime) -> int | None:
    return int((b - a).total_seconds() * 1000) if a else None


def realtime_message(env: EventEnvelope) -> dict[str, Any]:
    return {
        "event_id": str(env.event_id),
        "type": env.type,
        "seq": env.seq,
        "run_id": str(env.run_id) if env.run_id else None,
        "step_id": str(env.step_id) if env.step_id else None,
        "occurred_at": env.occurred_at.isoformat(),
        "payload": env.payload,
    }


def slim(msg: dict[str, Any]) -> dict[str, Any]:
    """Workspace feed messages drop large bodies (outputs, tool results)."""
    p = dict(msg["payload"])
    for k in ("output", "tools", "result", "args"):
        p.pop(k, None)
    return {**msg, "payload": p}


class Projector(Consumer):
    name = "nexus-projector"
    topics = [ev.LIFECYCLE]

    async def handle(self, env: EventEnvelope, topic: str, session: AsyncSession) -> None:
        await session.execute(
            insert(ExecutionEvent)
            .values(
                event_id=env.event_id,
                workspace_id=env.workspace_id,
                run_id=env.run_id,
                seq=env.seq,
                type=env.type,
                topic=topic,
                payload=env.payload,
                occurred_at=env.occurred_at,
            )
            .on_conflict_do_nothing(index_elements=["event_id"])
        )
        if env.run_id is None:
            return
        await self._project_run(env, session)

    async def _project_run(self, env: EventEnvelope, s: AsyncSession) -> None:
        t, p, at = env.type, env.payload, env.occurred_at
        run_q = update(WorkflowRun).where(WorkflowRun.id == env.run_id)
        seq_v = {"projected_seq": func.greatest(WorkflowRun.projected_seq, env.seq or 0)}

        if t == ev.WORKFLOW_STARTED:
            await s.execute(
                run_q.values(
                    status="running",
                    started_at=func.coalesce(WorkflowRun.started_at, at),
                    error=None,
                    **seq_v,
                )
            )
        elif t == ev.WORKFLOW_RESUMED:
            await s.execute(run_q.values(status="running", error=None, finished_at=None, **seq_v))
        elif t == ev.APPROVAL_REQUIRED:
            await s.execute(run_q.values(status="awaiting_approval", **seq_v))
            if env.step_id:
                await s.execute(update(RunStep).where(RunStep.id == env.step_id).values(status="awaiting_approval"))
        elif t in (ev.WORKFLOW_COMPLETED, ev.WORKFLOW_FAILED, ev.WORKFLOW_CANCELLED):
            run = await s.get(WorkflowRun, env.run_id)
            if run is None:
                return
            status = {
                ev.WORKFLOW_COMPLETED: "succeeded",
                ev.WORKFLOW_FAILED: p.get("status", "failed"),
                ev.WORKFLOW_CANCELLED: "cancelled",
            }[t]
            values: dict[str, Any] = {"status": status, "finished_at": at, "duration_ms": _ms(run.started_at, at), **seq_v}
            if t == ev.WORKFLOW_COMPLETED:
                values["output"] = p.get("output")
            else:
                values["error"] = p.get("error") or p.get("reason")
            await s.execute(run_q.values(**values))
            if t != ev.WORKFLOW_COMPLETED:
                # anything still marked running for this run did not finish
                await s.execute(
                    update(RunStep)
                    .where(RunStep.run_id == env.run_id, RunStep.status.in_(("running", "awaiting_approval")))
                    .values(status="cancelled" if status == "cancelled" else "failed", finished_at=at)
                )
        elif t == ev.AGENT_STARTED and env.step_id:
            await s.execute(
                insert(RunStep)
                .values(
                    id=env.step_id,
                    run_id=env.run_id,
                    node_id=p["node_id"],
                    agent_type=p["agent_type"],
                    label=p.get("label", p["node_id"]),
                    iteration=p.get("iteration", 1),
                    attempt=p.get("attempt", 1),
                    status="running",
                    input_summary=p.get("input_summary", ""),
                    started_at=at,
                    tools=[],
                )
                .on_conflict_do_nothing(index_elements=["id"])
            )
        elif t == ev.AGENT_COMPLETED and env.step_id:
            step = await s.get(RunStep, env.step_id)
            tin, tout = int(p.get("tokens_in", 0)), int(p.get("tokens_out", 0))
            if step is not None:
                step.status = "succeeded"
                step.output = p.get("output")
                step.tools = p.get("tools", [])
                step.tokens_in, step.tokens_out = tin, tout
                step.finished_at = at
                step.duration_ms = p.get("duration_ms") or _ms(step.started_at, at)
            await s.execute(
                run_q.values(tokens_in=WorkflowRun.tokens_in + tin, tokens_out=WorkflowRun.tokens_out + tout)
            )
        elif t == ev.AGENT_FAILED and env.step_id:
            await s.execute(
                update(RunStep)
                .where(RunStep.id == env.step_id)
                .values(
                    status="failed",
                    error=p.get("error"),
                    finished_at=at,
                    duration_ms=p.get("duration_ms"),
                )
            )
        elif t == ev.TOOL_CALLED and env.step_id:
            step = await s.get(RunStep, env.step_id)
            if step is not None:
                entry = {k: p.get(k) for k in ("tool", "args", "result", "error", "destructive")}
                step.tools = [*(step.tools or []), entry]

    async def after_commit(self, env: EventEnvelope, topic: str) -> None:
        msg = realtime_message(env)
        ps = get_pubsub()
        if env.run_id:
            await ps.publish(run_channel(env.run_id), msg)
        await ps.publish(workspace_channel(env.workspace_id), slim(msg))


async def run_seq_floor(s: AsyncSession, run_id) -> int:
    return (await s.execute(select(func.coalesce(func.max(ExecutionEvent.seq), 0)).where(ExecutionEvent.run_id == run_id))).scalar_one()
