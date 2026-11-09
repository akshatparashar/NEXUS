"""Consumes ``nexus.commands``: starts, resumes, retries and cancels runs; ingests documents."""

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.events import envelope as ev
from app.events.consumer import Consumer
from app.events.envelope import EventEnvelope
from app.rag.ingest import ingest_document
from app.workers.run_executor import RunExecutor

log = get_logger(__name__)


class CommandConsumer(Consumer):
    name = "nexus-worker"
    topics = [ev.COMMANDS]

    def __init__(self, executor: RunExecutor, *, inline: bool = False) -> None:
        super().__init__()
        self.executor = executor
        # inline (serverless): finish the work before returning, so the function stays alive for it
        self.inline = inline
        self.ingest_tasks: set[asyncio.Task] = set()

    async def handle(self, envelope: EventEnvelope, topic: str, session: AsyncSession) -> None:
        # Validation only; the work starts after the idempotency row commits (see after_commit).
        if envelope.type not in (ev.RUN_REQUESTED, ev.RUN_RESUME, ev.RUN_CANCEL, ev.DOCUMENT_UPLOADED):
            raise ValueError(f"Unknown command type {envelope.type}")

    async def after_commit(self, envelope: EventEnvelope, topic: str) -> None:
        t = envelope.type
        if t == ev.RUN_REQUESTED:
            assert envelope.run_id
            await self._run(envelope.run_id, envelope.payload.get("mode", "start"))
        elif t == ev.RUN_RESUME:
            assert envelope.run_id
            await self._run(envelope.run_id, "resume", envelope.payload.get("decision", {}))
        elif t == ev.RUN_CANCEL:
            assert envelope.run_id
            await self.executor.cancel(envelope.run_id)
        elif t == ev.DOCUMENT_UPLOADED:
            if self.inline:
                await ingest_document(uuid.UUID(envelope.payload["document_id"]))
                return
            task = asyncio.create_task(ingest_document(uuid.UUID(envelope.payload["document_id"])))
            self.ingest_tasks.add(task)
            task.add_done_callback(self.ingest_tasks.discard)

    async def _run(self, run_id: uuid.UUID, mode: str, resume: object = None) -> None:
        if self.inline:
            await self.executor.run_now(run_id, mode, resume)
        else:
            self.executor.submit(run_id, mode, resume)

    async def wait_idle(self) -> None:
        while self.ingest_tasks:
            await asyncio.gather(*list(self.ingest_tasks), return_exceptions=True)
