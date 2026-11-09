"""Message bus abstraction with two implementations.

* ``KafkaBus``  – Apache Kafka through aiokafka. Used in Docker Compose and production.
* ``MemoryBus`` – an in-process bus with the same consumer-group semantics (each group gets every
  message once, ordered per key). Used by the tests and by the no-Docker local mode.

Both deliver ``(topic, key, value)`` to a handler and only advance after the handler returns, so
the at-least-once contract is the same either way.
"""

import asyncio
import contextlib
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from app.core.config import get_settings
from app.core.logging import get_logger
from app.events.envelope import ALL_TOPICS

log = get_logger(__name__)

Handler = Callable[[str, bytes], Awaitable[None]]


@dataclass
class TopicStats:
    produced: int = 0


class MessageBus:
    name = "base"

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    async def publish(self, topic: str, key: str, value: bytes) -> None:
        raise NotImplementedError

    async def subscribe(self, topics: list[str], group: str, handler: Handler) -> None:
        """Run a consumer loop until cancelled."""
        raise NotImplementedError

    async def lag(self, group: str) -> dict[str, int]:
        return {}

    async def healthy(self) -> bool:
        return True


# --- In-memory --------------------------------------------------------------------------------


@dataclass
class _Group:
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)


class MemoryBus(MessageBus):
    name = "memory"

    def __init__(self) -> None:
        self._groups: dict[str, dict[str, _Group]] = defaultdict(dict)  # topic -> group -> queue
        self.stats: dict[str, TopicStats] = defaultdict(TopicStats)

    async def publish(self, topic: str, key: str, value: bytes) -> None:
        self.stats[topic].produced += 1
        for g in self._groups[topic].values():
            g.queue.put_nowait((topic, value))

    def _register(self, topics: list[str], group: str) -> list[asyncio.Queue]:
        queues = []
        for t in topics:
            g = self._groups[t].setdefault(group, _Group())
            queues.append(g.queue)
        return queues

    async def subscribe(self, topics: list[str], group: str, handler: Handler) -> None:
        queues = self._register(topics, group)

        async def drain(q: asyncio.Queue) -> None:
            while True:
                topic, value = await q.get()
                try:
                    await handler(topic, value)
                except Exception:  # the consumer base already handled retries + DLQ
                    log.exception("memory_bus_handler_error", group=group, topic=topic)
                finally:
                    q.task_done()

        await asyncio.gather(*(drain(q) for q in queues))

    async def lag(self, group: str) -> dict[str, int]:
        return {t: gs[group].queue.qsize() for t, gs in self._groups.items() if group in gs}

    async def join(self) -> None:
        """Test helper: wait until every queue is drained."""
        for groups in list(self._groups.values()):
            for g in list(groups.values()):
                await g.queue.join()


# --- Kafka ------------------------------------------------------------------------------------


class KafkaBus(MessageBus):
    name = "kafka"

    def __init__(self) -> None:
        self._producer = None
        self._consumers: dict[str, object] = {}
        self.stats: dict[str, TopicStats] = defaultdict(TopicStats)

    async def start(self) -> None:
        from aiokafka import AIOKafkaProducer

        s = get_settings()
        await self._ensure_topics()
        self._producer = AIOKafkaProducer(
            bootstrap_servers=s.kafka_bootstrap_servers,
            client_id=f"{s.kafka_client_id}-{s.run_mode}",
            acks="all",
            enable_idempotence=True,
            linger_ms=5,
        )
        await self._producer.start()

    async def _ensure_topics(self) -> None:
        from aiokafka.admin import AIOKafkaAdminClient, NewTopic
        from aiokafka.errors import TopicAlreadyExistsError

        s = get_settings()
        admin = AIOKafkaAdminClient(bootstrap_servers=s.kafka_bootstrap_servers)
        for attempt in range(30):
            try:
                await admin.start()
                break
            except Exception:
                log.info("kafka_waiting", attempt=attempt)
                await asyncio.sleep(2)
        try:
            existing = set(await admin.list_topics())
            new = [NewTopic(t, num_partitions=6, replication_factor=1) for t in ALL_TOPICS if t not in existing]
            if new:
                with contextlib.suppress(TopicAlreadyExistsError):
                    await admin.create_topics(new)
        finally:
            await admin.close()

    async def stop(self) -> None:
        if self._producer:
            await self._producer.stop()
        for c in self._consumers.values():
            with contextlib.suppress(Exception):
                await c.stop()  # type: ignore[attr-defined]

    async def publish(self, topic: str, key: str, value: bytes) -> None:
        assert self._producer is not None, "KafkaBus.start() was not called"
        await self._producer.send_and_wait(topic, value=value, key=key.encode())
        self.stats[topic].produced += 1

    async def subscribe(self, topics: list[str], group: str, handler: Handler) -> None:
        from aiokafka import AIOKafkaConsumer

        s = get_settings()
        consumer = AIOKafkaConsumer(
            *topics,
            bootstrap_servers=s.kafka_bootstrap_servers,
            group_id=group,
            client_id=f"{s.kafka_client_id}-{group}",
            enable_auto_commit=False,
            auto_offset_reset="earliest",
        )
        await consumer.start()
        self._consumers[group] = consumer
        try:
            async for msg in consumer:
                try:
                    await handler(msg.topic, msg.value)
                except Exception:
                    log.exception("kafka_handler_error", group=group, topic=msg.topic, offset=msg.offset)
                await consumer.commit()
        finally:
            await consumer.stop()
            self._consumers.pop(group, None)

    async def lag(self, group: str) -> dict[str, int]:
        consumer = self._consumers.get(group)
        if consumer is None:
            return {}
        out: dict[str, int] = defaultdict(int)
        for tp in consumer.assignment():  # type: ignore[attr-defined]
            hw = consumer.highwater(tp)  # type: ignore[attr-defined]
            pos = await consumer.position(tp)  # type: ignore[attr-defined]
            if hw is not None:
                out[tp.topic] += max(0, hw - pos)
        return dict(out)

    async def healthy(self) -> bool:
        return self._producer is not None


_bus: MessageBus | None = None


def get_bus() -> MessageBus:
    global _bus
    if _bus is None:
        _bus = KafkaBus() if get_settings().event_bus == "kafka" else MemoryBus()
    return _bus


def set_bus(bus: MessageBus | None) -> None:
    global _bus
    _bus = bus
