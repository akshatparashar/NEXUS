import uuid

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.core.deps import CurrentWorkspace, SessionDep
from app.core.errors import Conflict, NotFound
from app.events.envelope import EventEnvelope
from app.events.outbox import enqueue, flush
from app.models import DeadLetter, utcnow
from app.services import metrics_service

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


@router.get("/overview")
async def overview(session: SessionDep, ws: CurrentWorkspace, days: int = Query(14, ge=1, le=90)) -> dict:
    return await metrics_service.overview(session, ws.id, days)


@router.get("/agents")
async def agents(session: SessionDep, ws: CurrentWorkspace) -> list[dict]:
    return await metrics_service.agent_stats(session, ws.id)


@router.get("/events")
async def events(
    session: SessionDep,
    ws: CurrentWorkspace,
    limit: int = Query(100, ge=1, le=500),
    type: str | None = None,
    run_id: uuid.UUID | None = None,
) -> list[dict]:
    return await metrics_service.recent_events(session, ws.id, limit, type, run_id)


@router.get("/pipeline")
async def pipeline(session: SessionDep, ws: CurrentWorkspace) -> dict:
    """Event pipeline health: outbox per topic, consumer throughput and lag, dead letters."""
    data = await metrics_service.pipeline(session)
    data["dead_letters"] = await metrics_service.dead_letters(session, ws.id)
    return data


@router.post("/dead-letters/{dl_id}/replay", status_code=202)
async def replay_dead_letter(dl_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace) -> dict:
    dl = (await session.execute(select(DeadLetter).where(DeadLetter.id == dl_id))).scalars().first()
    if dl is None or dl.envelope.get("workspace_id") != str(ws.id):
        raise NotFound("Dead letter not found.")
    if dl.replayed_at is not None:
        raise Conflict("Already replayed.")
    # A replay is a new event (fresh id) so the idempotency ledger does not swallow it.
    env = EventEnvelope.model_validate({**dl.envelope, "event_id": str(uuid.uuid4())})
    enqueue(session, dl.topic, env)
    dl.replayed_at = utcnow()
    await session.commit()
    await flush()
    return {"replayed": True, "event_id": str(env.event_id)}
