"""Realtime fan-out for SSE. Redis pub/sub across processes, or in-process when Redis is not configured.

Use as::

    async with get_pubsub().subscription(channel) as sub:   # subscribed once this returns
        ...replay history from the database...
        async for message in sub: ...

Subscribing *before* replaying history means no event can fall into the gap between the two.
"""

import asyncio
import contextlib
import json
from collections import defaultdict
from collections.abc import AsyncIterator
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


def run_channel(run_id: Any) -> str:
    return f"run:{run_id}"


def workspace_channel(workspace_id: Any) -> str:
    return f"ws:{workspace_id}"


class Subscription:
    async def __aenter__(self) -> "Subscription":
        return self

    async def __aexit__(self, *exc: object) -> None: ...

    def __aiter__(self) -> AsyncIterator[dict]:
        return self._iter()

    async def _iter(self) -> AsyncIterator[dict]:  # pragma: no cover - interface
        raise NotImplementedError
        yield {}

    async def get(self, timeout: float) -> dict | None:
        raise NotImplementedError


class PubSub:
    async def publish(self, channel: str, message: dict) -> None:
        raise NotImplementedError

    def subscription(self, channel: str) -> Subscription:
        raise NotImplementedError

    async def close(self) -> None: ...

    async def healthy(self) -> bool:
        return True


# --- in-process ------------------------------------------------------------------------------


class _MemorySub(Subscription):
    def __init__(self, hub: "MemoryPubSub", channel: str) -> None:
        self.hub, self.channel = hub, channel
        self.q: asyncio.Queue = asyncio.Queue(maxsize=5000)

    async def __aenter__(self) -> "_MemorySub":
        self.hub._subs[self.channel].add(self.q)
        return self

    async def __aexit__(self, *exc: object) -> None:
        self.hub._subs[self.channel].discard(self.q)

    async def _iter(self) -> AsyncIterator[dict]:
        while True:
            yield await self.q.get()

    async def get(self, timeout: float) -> dict | None:
        try:
            return await asyncio.wait_for(self.q.get(), timeout)
        except TimeoutError:
            return None


class MemoryPubSub(PubSub):
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)

    async def publish(self, channel: str, message: dict) -> None:
        for q in list(self._subs.get(channel, ())):
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(message)

    def subscription(self, channel: str) -> Subscription:
        return _MemorySub(self, channel)


# --- Redis -----------------------------------------------------------------------------------


class _RedisSub(Subscription):
    def __init__(self, redis: Any, channel: str) -> None:
        self.redis, self.channel = redis, channel
        self.ps: Any = None

    async def __aenter__(self) -> "_RedisSub":
        self.ps = self.redis.pubsub(ignore_subscribe_messages=True)
        await self.ps.subscribe(self.channel)
        return self

    async def __aexit__(self, *exc: object) -> None:
        with contextlib.suppress(Exception):
            await self.ps.unsubscribe(self.channel)
            await self.ps.aclose()

    async def _iter(self) -> AsyncIterator[dict]:
        while True:
            msg = await self.get(30)
            if msg is not None:
                yield msg

    async def get(self, timeout: float) -> dict | None:
        msg = await self.ps.get_message(ignore_subscribe_messages=True, timeout=timeout)
        if msg and msg.get("type") == "message":
            return json.loads(msg["data"])
        return None


class RedisPubSub(PubSub):
    def __init__(self, url: str) -> None:
        import redis.asyncio as redis

        self._redis = redis.from_url(url, decode_responses=True)

    async def publish(self, channel: str, message: dict) -> None:
        await self._redis.publish(channel, json.dumps(message, default=str))

    def subscription(self, channel: str) -> Subscription:
        return _RedisSub(self._redis, channel)

    async def close(self) -> None:
        await self._redis.aclose()

    async def healthy(self) -> bool:
        try:
            return bool(await self._redis.ping())
        except Exception:
            return False

    @property
    def client(self) -> Any:
        return self._redis


_pubsub: PubSub | None = None


def get_pubsub() -> PubSub:
    global _pubsub
    if _pubsub is None:
        url = get_settings().redis_url
        _pubsub = RedisPubSub(url) if url else MemoryPubSub()
    return _pubsub


def set_pubsub(ps: PubSub | None) -> None:
    global _pubsub
    _pubsub = ps
