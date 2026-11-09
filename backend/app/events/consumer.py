"""Base class for idempotent consumers with bounded retries and a dead-letter queue."""

import asyncio
from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database.session import session_scope
from app.events.bus import get_bus
from app.events.envelope import DLQ, EventEnvelope
from app.models import ConsumerStat, DeadLetter, ProcessedEvent

log = get_logger(__name__)


class Consumer:
    name: str = "consumer"
    topics: list[str] = []
    max_attempts: int = 3
    backoff_base: float = 0.2

    def __init__(self) -> None:
        self._processed: dict[str, int] = defaultdict(int)
        self._failed: dict[str, int] = defaultdict(int)
        self._last_at: dict[str, datetime] = {}

    async def handle(self, envelope: EventEnvelope, topic: str, session: AsyncSession) -> None:
        raise NotImplementedError

    async def after_commit(self, envelope: EventEnvelope, topic: str) -> None:
        """Side effects that must happen only after the transaction committed (fan-out, task spawn)."""

    async def __call__(self, topic: str, raw: bytes) -> None:
        try:
            envelope = EventEnvelope.from_bytes(raw)
        except Exception as e:
            log.error("consumer_bad_message", consumer=self.name, topic=topic, error=str(e))
            self._failed[topic] += 1
            return

        last_error: Exception | None = None
        for attempt in range(1, self.max_attempts + 1):
            try:
                handled = await self._process(envelope, topic)
                if handled:
                    await self.after_commit(envelope, topic)
                self._processed[topic] += 1
                self._last_at[topic] = datetime.now(UTC)
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                last_error = e
                log.warning(
                    "consumer_attempt_failed",
                    consumer=self.name,
                    type=envelope.type,
                    attempt=attempt,
                    error=str(e),
                )
                await asyncio.sleep(self.backoff_base * 2 ** (attempt - 1))

        await self._dead_letter(envelope, topic, last_error)

    async def _process(self, envelope: EventEnvelope, topic: str) -> bool:
        async with session_scope() as session:
            inserted = await session.execute(
                insert(ProcessedEvent)
                .values(consumer=self.name, event_id=envelope.event_id)
                .on_conflict_do_nothing()
                .returning(ProcessedEvent.event_id)
            )
            if inserted.first() is None:
                log.debug("consumer_duplicate_skipped", consumer=self.name, event_id=str(envelope.event_id))
                return False
            await self.handle(envelope, topic, session)
        return True

    async def _dead_letter(self, envelope: EventEnvelope, topic: str, error: Exception | None) -> None:
        self._failed[topic] += 1
        log.error("consumer_dead_letter", consumer=self.name, type=envelope.type, error=str(error))
        try:
            async with session_scope() as session:
                session.add(
                    DeadLetter(
                        consumer=self.name,
                        topic=topic,
                        event_id=envelope.event_id,
                        type=envelope.type,
                        envelope=envelope.model_dump(mode="json"),
                        error=str(error)[:4000],
                        attempts=self.max_attempts,
                    )
                )
            await get_bus().publish(DLQ, envelope.key, envelope.to_bytes())
        except Exception:
            log.exception("dead_letter_write_failed")

    async def flush_stats(self) -> None:
        lag = await get_bus().lag(self.name)
        now = datetime.now(UTC)
        async with session_scope() as session:
            for topic in self.topics:
                stmt = insert(ConsumerStat).values(
                    consumer=self.name,
                    topic=topic,
                    processed=self._processed[topic],
                    failed=self._failed[topic],
                    lag=lag.get(topic, 0),
                    last_event_at=self._last_at.get(topic),
                    updated_at=now,
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["consumer", "topic"],
                    set_={
                        "processed": ConsumerStat.processed + stmt.excluded.processed,
                        "failed": ConsumerStat.failed + stmt.excluded.failed,
                        "lag": stmt.excluded.lag,
                        "last_event_at": func.coalesce(stmt.excluded.last_event_at, ConsumerStat.last_event_at),
                        "updated_at": now,
                    },
                )
                await session.execute(stmt)
        self._processed.clear()
        self._failed.clear()

    async def run(self) -> None:
        log.info("consumer_started", consumer=self.name, topics=self.topics)

        async def stats_loop() -> None:
            while True:
                await asyncio.sleep(2)
                try:
                    await self.flush_stats()
                except Exception:
                    log.exception("consumer_stats_failed", consumer=self.name)

        stats = asyncio.create_task(stats_loop())
        try:
            await get_bus().subscribe(self.topics, self.name, self)
        finally:
            stats.cancel()
