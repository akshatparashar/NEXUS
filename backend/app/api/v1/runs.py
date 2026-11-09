import asyncio
import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Header, Query, Request
from sqlalchemy import func, select
from sse_starlette.sse import EventSourceResponse

from app.core.config import get_settings
from app.core.deps import CurrentUser, CurrentWorkspace, SessionDep
from app.database.session import session_scope
from app.events import envelope as ev
from app.events.pubsub import get_pubsub, run_channel, workspace_channel
from app.models import ExecutionEvent, WorkflowRun
from app.schemas import ApprovalDecision, ApprovalOut, ArtifactOut, RunOut, RunSummary, StepOut
from app.services import run_service

router = APIRouter(tags=["runs"])

TERMINAL_EVENTS = {ev.WORKFLOW_COMPLETED, ev.WORKFLOW_FAILED, ev.WORKFLOW_CANCELLED}


@router.get("/runs", response_model=list[RunSummary])
async def list_runs(
    session: SessionDep,
    ws: CurrentWorkspace,
    status: str | None = None,
    workflow_id: uuid.UUID | None = None,
    limit: int = Query(30, ge=1, le=200),
    before: str | None = None,
) -> list[WorkflowRun]:
    q = select(WorkflowRun).where(WorkflowRun.workspace_id == ws.id)
    if status:
        q = q.where(WorkflowRun.status.in_(status.split(",")))
    if workflow_id:
        q = q.where(WorkflowRun.workflow_id == workflow_id)
    if before:
        from datetime import datetime

        q = q.where(WorkflowRun.queued_at < datetime.fromisoformat(before))
    return list((await session.execute(q.order_by(WorkflowRun.queued_at.desc()).limit(limit))).scalars().all())


@router.get("/runs/{run_id}", response_model=RunOut)
async def get_run(run_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace) -> RunOut:
    run = await run_service.get_run(session, ws, run_id, full=True)
    approvals, artifacts = await run_service.run_extras(session, run.id)
    last_seq = (
        await session.execute(select(func.coalesce(func.max(ExecutionEvent.seq), 0)).where(ExecutionEvent.run_id == run.id))
    ).scalar_one()
    out = RunOut.model_validate(run)
    out.steps = [StepOut.model_validate(s) for s in sorted(run.steps, key=lambda s: s.started_at)]
    out.approvals = [ApprovalOut.model_validate(a) for a in approvals]
    out.artifacts = [ArtifactOut.model_validate(a) for a in artifacts]
    out.last_seq = last_seq
    return out


@router.get("/runs/{run_id}/events")
async def run_events(run_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace, after: int = 0) -> list[dict]:
    await run_service.get_run(session, ws, run_id)
    rows = (
        await session.execute(
            select(ExecutionEvent).where(ExecutionEvent.run_id == run_id, ExecutionEvent.seq > after).order_by(ExecutionEvent.seq)
        )
    ).scalars().all()
    return [_event_dict(e) for e in rows]


def _event_dict(e: ExecutionEvent) -> dict:
    return {
        "event_id": str(e.event_id),
        "type": e.type,
        "seq": e.seq,
        "run_id": str(e.run_id) if e.run_id else None,
        "occurred_at": e.occurred_at.isoformat(),
        "payload": e.payload,
    }


@router.post("/runs/{run_id}/cancel", response_model=RunSummary, status_code=202)
async def cancel(run_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace) -> WorkflowRun:
    return await run_service.cancel_run(session, ws, run_id)


@router.post("/runs/{run_id}/retry", response_model=RunSummary, status_code=202)
async def retry(run_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace) -> WorkflowRun:
    return await run_service.retry_run(session, ws, run_id)


@router.post("/approvals/{approval_id}/decision", response_model=ApprovalOut)
async def decide(
    approval_id: uuid.UUID, body: ApprovalDecision, session: SessionDep, ws: CurrentWorkspace, user: CurrentUser
) -> ApprovalOut:
    a = await run_service.decide_approval(session, ws, user, approval_id, body.approve, body.actions, body.note)
    return ApprovalOut.model_validate(a)


@router.get("/approvals", response_model=list[ApprovalOut])
async def pending_approvals(session: SessionDep, ws: CurrentWorkspace) -> list[ApprovalOut]:
    from app.models import Approval

    rows = (
        await session.execute(
            select(Approval).where(Approval.workspace_id == ws.id, Approval.status == "pending").order_by(Approval.created_at.desc())
        )
    ).scalars().all()
    return [ApprovalOut.model_validate(a) for a in rows]


@router.get("/runs/{run_id}/artifacts", response_model=list[ArtifactOut])
async def artifacts(run_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace) -> list[ArtifactOut]:
    await run_service.get_run(session, ws, run_id)
    _, arts = await run_service.run_extras(session, run_id)
    return [ArtifactOut.model_validate(a) for a in arts]


# --- realtime ---------------------------------------------------------------------------------


@router.get("/runs/{run_id}/stream")
async def stream_run(
    run_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    ws: CurrentWorkspace,
    last_event_id: Annotated[str | None, Header()] = None,
    after: int = 0,
) -> EventSourceResponse:
    """Server-Sent Events for one run.

    Replays persisted events after ``Last-Event-ID`` (or ``?after=``), then streams live ones.
    Token deltas arrive as ``token`` events without ids (they are not persisted).
    """
    run = await run_service.get_run(session, ws, run_id)
    await session.close()  # return the connection to the pool instead of holding it for the whole stream
    start_after = int(last_event_id) if last_event_id and last_event_id.isdigit() else after
    already_done = run.status in ("succeeded", "failed", "cancelled", "timed_out")
    # serverless: the run may be executing in another instance, so lifecycle events are also read
    # from the event log; and a run whose worker vanished is queued again here
    poll_log = get_settings().serverless
    # COMMAND_QUEUE=stream: this request is where the run executes (serverless hosts only do work
    # while a request is open). The driver takes the run's pending commands; a second viewer finds
    # nothing to take, and a run whose viewer left is resumed from its checkpoint by the next one.
    drives = poll_log and get_settings().command_queue == "stream"
    if poll_log and not already_done:
        await run_service.kick_if_stale(run_id)

    async def gen():
        driver: asyncio.Task | None = None

        def drive() -> None:
            nonlocal driver
            if drives and not already_done and (driver is None or driver.done()):
                from app.workers.vercel_queue import drive_run

                driver = asyncio.create_task(drive_run(run_id))

        try:
            async for item in _stream(drive):
                yield item
        finally:
            if driver is not None and not driver.done():
                driver.cancel()  # the lease stays; the next viewer resumes from the checkpoint

    async def _stream(drive):
        last = start_after
        async with get_pubsub().subscription(run_channel(run_id)) as sub:
            async with session_scope() as s:
                rows = (
                    await s.execute(
                        select(ExecutionEvent)
                        .where(ExecutionEvent.run_id == run_id, ExecutionEvent.seq > start_after)
                        .order_by(ExecutionEvent.seq)
                    )
                ).scalars().all()
            finished = False
            for e in rows:
                last = max(last, e.seq or 0)
                yield {"event": "lifecycle", "id": str(e.seq), "data": json.dumps(_event_dict(e))}
                finished = finished or e.type in TERMINAL_EVENTS
            if finished and already_done:
                yield {"event": "end", "data": "{}"}
                return
            drive()
            while not await request.is_disconnected():
                msg = await sub.get(timeout=1.5 if poll_log else 15)
                if msg is None:
                    if not poll_log:
                        continue
                    drive()  # picks up a resume after an approval, or a recovery
                    async with session_scope() as s:
                        rows = (
                            await s.execute(
                                select(ExecutionEvent)
                                .where(ExecutionEvent.run_id == run_id, ExecutionEvent.seq > last)
                                .order_by(ExecutionEvent.seq)
                            )
                        ).scalars().all()
                    for e in rows:
                        last = max(last, e.seq or 0)
                        yield {"event": "lifecycle", "id": str(e.seq), "data": json.dumps(_event_dict(e))}
                        if e.type in TERMINAL_EVENTS:
                            yield {"event": "end", "data": "{}"}
                            return
                    continue
                if msg.get("type") == ev.AGENT_TOKEN:
                    yield {"event": "token", "data": json.dumps(msg)}
                    continue
                seq = msg.get("seq") or 0
                if seq and seq <= last:
                    continue
                last = max(last, seq)
                yield {"event": "lifecycle", "id": str(seq), "data": json.dumps(msg, default=str)}
                if msg.get("type") in TERMINAL_EVENTS:
                    await asyncio.sleep(0.05)
                    yield {"event": "end", "data": "{}"}
                    return

    return EventSourceResponse(gen(), ping=15, headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


@router.get("/stream/activity")
async def stream_activity(request: Request, session: SessionDep, ws: CurrentWorkspace) -> EventSourceResponse:
    """Workspace-wide live feed (dashboard, monitoring, knowledge base status)."""
    ws_id = ws.id
    await session.close()  # the auth lookup is done; don't hold a connection for an open-ended stream

    async def gen():
        async with get_pubsub().subscription(workspace_channel(ws_id)) as sub:
            yield {"event": "ready", "data": "{}"}
            while not await request.is_disconnected():
                msg = await sub.get(timeout=15)
                if msg is not None:
                    yield {"event": "activity", "data": json.dumps(msg, default=str)}

    return EventSourceResponse(gen(), ping=15, headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})
