"""Emitting lifecycle events from the worker.

Lifecycle events go through the transactional outbox → Kafka → projector. Token deltas are high
volume and ephemeral, so they skip Kafka and go straight to the realtime channel.
"""

import uuid
from typing import Any

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import session_scope
from app.events.envelope import AGENT_TOKEN, LIFECYCLE, EventEnvelope
from app.events.outbox import enqueue, nudge
from app.events.pubsub import get_pubsub, run_channel
from app.models import WorkflowRun


class RunEmitter:
    def __init__(self, run_id: uuid.UUID, workspace_id: uuid.UUID) -> None:
        self.run_id = run_id
        self.workspace_id = workspace_id

    async def emit(self, type_: str, payload: dict[str, Any] | None = None, step_id: uuid.UUID | None = None) -> EventEnvelope:
        async with session_scope() as s:
            seq = (
                await s.execute(
                    update(WorkflowRun)
                    .where(WorkflowRun.id == self.run_id)
                    .values(event_seq=WorkflowRun.event_seq + 1)
                    .returning(WorkflowRun.event_seq)
                )
            ).scalar_one()
            env = EventEnvelope(
                type=type_,
                workspace_id=self.workspace_id,
                run_id=self.run_id,
                step_id=step_id,
                seq=seq,
                payload=payload or {},
            )
            enqueue(s, LIFECYCLE, env)
        nudge()
        return env

    async def token(self, node_id: str, step_id: uuid.UUID, text: str) -> None:
        await get_pubsub().publish(
            run_channel(self.run_id),
            {"type": AGENT_TOKEN, "run_id": str(self.run_id), "node_id": node_id, "step_id": str(step_id), "text": text},
        )


def emit_workspace_event(session: AsyncSession, type_: str, workspace_id: uuid.UUID, payload: dict[str, Any]) -> EventEnvelope:
    env = EventEnvelope(type=type_, workspace_id=workspace_id, payload=payload)
    enqueue(session, LIFECYCLE, env)
    return env
