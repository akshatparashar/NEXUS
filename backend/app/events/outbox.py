"""Transactional outbox and its relay.

Services call :func:`enqueue` inside the same SQLAlchemy transaction that changes domain rows. The
relay publishes committed rows to the bus and marks them published. If the process dies between
commit and publish, the row is still there and is published on the next pass: no event is lost.
"""

import asyncio
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database.session import session_scope
from app.events.bus import get_bus
from app.events.envelope import EventEnvelope
from app.models import OutboxMessage

log = get_logger(__name__)

_wakeup = asyncio.Event()


def enqueue(session: AsyncSession, topic: str, envelope: EventEnvelope) -> None:
    session.add(
        OutboxMessage(
            event_id=envelope.event_id,
            topic=topic,
            key=envelope.key,
            type=envelope.type,
            payload=envelope.model_dump(mode="json"),
        )
    )


def nudge() -> None:
    """Wake the relay right away (called after a commit that enqueued messages)."""
    _wakeup.set()


async def relay_once(batch: int = 200) -> int:
    bus = get_bus()
    async with session_scope() as session:
        rows = (
            await session.execute(
                select(OutboxMessage)
                .where(OutboxMessage.published_at.is_(None))
                .order_by(OutboxMessage.id)
                .limit(batch)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()
        if not rows:
            return 0
        published: list[int] = []
        for row in rows:
            try:
                env = EventEnvelope.model_validate(row.payload)
                await bus.publish(row.topic, row.key, env.to_bytes())
                published.append(row.id)
            except Exception as e:  # keep order: stop at the first failure, retry next pass
                log.warning("outbox_publish_failed", id=row.id, error=str(e))
                await session.execute(
                    update(OutboxMessage).where(OutboxMessage.id == row.id).values(attempts=row.attempts + 1)
                )
                break
        if published:
            await session.execute(
                update(OutboxMessage)
                .where(OutboxMessage.id.in_(published))
                .values(published_at=datetime.now(UTC))
            )
        return len(published)


async def run_relay(poll_interval: float = 0.25) -> None:
    log.info("outbox_relay_started")
    while True:
        try:
            n = await relay_once()
            if n:
                continue  # drain backlog without sleeping
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("outbox_relay_error")
            await asyncio.sleep(1)
        _wakeup.clear()
        try:
            await asyncio.wait_for(_wakeup.wait(), timeout=poll_interval)
        except TimeoutError:
            pass
