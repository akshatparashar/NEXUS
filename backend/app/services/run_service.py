import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agents.llm import LLMNotConfigured
from app.core.config import get_settings
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.events import envelope as ev
from app.events.emitter import RunEmitter
from app.events.envelope import EventEnvelope
from app.events.outbox import enqueue, nudge
from app.models import Approval, RunArtifact, User, Workflow, WorkflowRun, Workspace
from app.orchestration.spec import GraphInvalid, parse_graph

ACTIVE = ("queued", "running", "awaiting_approval")


async def get_run(session: AsyncSession, ws: Workspace, run_id: uuid.UUID, *, full: bool = False) -> WorkflowRun:
    q = select(WorkflowRun).where(WorkflowRun.id == run_id, WorkflowRun.workspace_id == ws.id)
    if full:
        q = q.options(selectinload(WorkflowRun.steps))
    run = (await session.execute(q)).scalars().first()
    if run is None:
        raise NotFound("Run not found.")
    return run


async def create_run(session: AsyncSession, ws: Workspace, user: User, workflow: Workflow, task: str) -> WorkflowRun:
    if not get_settings().llm_configured:
        s = get_settings()
        raise LLMNotConfigured(
            f"No API key for LLM_PROVIDER={s.llm_provider}. Add it to .env, or set LLM_PROVIDER=ollama to run locally."
        )
    try:
        parse_graph(workflow.graph)
    except GraphInvalid as e:
        raise ValidationFailed("This workflow cannot run yet.", code="graph_invalid", details={"problems": e.problems}) from e

    run = WorkflowRun(
        workspace_id=ws.id,
        workflow_id=workflow.id,
        workflow_version=workflow.version,
        workflow_name=workflow.name,
        graph_snapshot=workflow.graph,
        status="queued",
        input={"task": task.strip()},
        triggered_by=user.id,
    )
    session.add(run)
    await session.flush()
    # Same transaction: the run row and its command commit together or not at all.
    enqueue(session, ev.COMMANDS, EventEnvelope(type=ev.RUN_REQUESTED, workspace_id=ws.id, run_id=run.id, payload={"mode": "start"}))
    await session.commit()
    nudge()
    return run


async def cancel_run(session: AsyncSession, ws: Workspace, run_id: uuid.UUID) -> WorkflowRun:
    run = await get_run(session, ws, run_id)
    if run.status not in ACTIVE:
        raise Conflict("Only queued, running or waiting runs can be cancelled.")
    enqueue(session, ev.COMMANDS, EventEnvelope(type=ev.RUN_CANCEL, workspace_id=ws.id, run_id=run.id))
    await session.commit()
    nudge()
    return run


async def retry_run(session: AsyncSession, ws: Workspace, run_id: uuid.UUID) -> WorkflowRun:
    """Failed or timed-out runs continue from their last checkpoint; finished steps are not redone."""
    run = await get_run(session, ws, run_id)
    if run.status not in ("failed", "timed_out"):
        raise Conflict("Only failed or timed-out runs can be retried.")
    run.status = "queued"
    run.error = None
    run.finished_at = None
    run.worker_id = None
    enqueue(session, ev.COMMANDS, EventEnvelope(type=ev.RUN_REQUESTED, workspace_id=ws.id, run_id=run.id, payload={"mode": "retry"}))
    await session.commit()
    nudge()
    return run


async def decide_approval(
    session: AsyncSession,
    ws: Workspace,
    user: User,
    approval_id: uuid.UUID,
    approve: bool,
    per_action: dict[int, bool] | None,
    note: str,
) -> Approval:
    approval = (
        await session.execute(select(Approval).where(Approval.id == approval_id, Approval.workspace_id == ws.id))
    ).scalars().first()
    if approval is None:
        raise NotFound("Approval request not found.")
    if approval.status != "pending":
        raise Conflict("This request was already decided.")
    run = await get_run(session, ws, approval.run_id)
    if run.status != "awaiting_approval":
        raise Conflict("The run is no longer waiting for approval.")

    decisions = {int(a["index"]): approve for a in approval.actions}
    for idx, val in (per_action or {}).items():
        if idx in decisions:
            decisions[idx] = val
    any_approved = any(decisions.values())
    approval.status = "approved" if any_approved else "rejected"
    approval.decided_by = user.id
    approval.decided_at = datetime.now(UTC)
    approval.decision = {"approved": {str(k): v for k, v in decisions.items()}, "note": note, "by": user.name}
    enqueue(
        session,
        ev.COMMANDS,
        EventEnvelope(
            type=ev.RUN_RESUME,
            workspace_id=ws.id,
            run_id=run.id,
            payload={"decision": {"approved": {str(k): v for k, v in decisions.items()}}},
        ),
    )
    await session.commit()
    await RunEmitter(run.id, ws.id).emit(
        ev.APPROVAL_RESOLVED,
        {
            "approval_id": str(approval.id),
            "status": approval.status,
            "decided_by": user.name,
            "approved": {str(k): v for k, v in decisions.items()},
            "note": note,
        },
    )
    return approval


async def run_extras(session: AsyncSession, run_id: uuid.UUID) -> tuple[list[Approval], list[RunArtifact]]:
    approvals = (
        await session.execute(select(Approval).where(Approval.run_id == run_id).order_by(Approval.created_at))
    ).scalars().all()
    artifacts = (
        await session.execute(select(RunArtifact).where(RunArtifact.run_id == run_id).order_by(RunArtifact.created_at))
    ).scalars().all()
    return list(approvals), list(artifacts)
