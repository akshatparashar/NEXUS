"""Starts the background roles this process is responsible for (see ``Settings.run_mode``)."""

import asyncio
import contextlib

from app.core.config import get_settings
from app.core.logging import get_logger
from app.events.bus import get_bus
from app.events.outbox import run_relay
from app.workers.checkpointer import close_checkpointer, get_checkpointer
from app.workers.command_consumer import CommandConsumer
from app.workers.projector import Projector
from app.workers.run_executor import RunExecutor

log = get_logger(__name__)


class BackgroundRuntime:
    def __init__(self) -> None:
        self.tasks: list[asyncio.Task] = []
        self.executor: RunExecutor | None = None
        self.commands: CommandConsumer | None = None
        self.projector: Projector | None = None

    async def start(self) -> None:
        s = get_settings()
        await get_bus().start()
        if s.runs_projector:
            self.projector = Projector()
            self.tasks.append(asyncio.create_task(self.projector.run(), name="projector"))
        if s.runs_workers:
            await get_checkpointer()
            self.executor = RunExecutor()
            self.commands = CommandConsumer(self.executor)
            self.tasks.append(asyncio.create_task(self.commands.run(), name="worker"))
            self.tasks.append(asyncio.create_task(self._recovery_loop(), name="recovery"))
        if s.runs_relay:
            self.tasks.append(asyncio.create_task(run_relay(), name="outbox-relay"))
        log.info("background_runtime_started", mode=s.run_mode, bus=get_bus().name, tasks=[t.get_name() for t in self.tasks])

    async def _recovery_loop(self) -> None:
        assert self.executor
        await asyncio.sleep(2)
        while True:
            try:
                n = await self.executor.recover()
                if n:
                    log.info("runs_recovered", count=n)
            except Exception:
                log.exception("recovery_failed")
            await asyncio.sleep(30)

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        if self.executor:
            for t in list(self.executor.tasks.values()):
                t.cancel()
        for t in self.tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        await get_bus().stop()
        await close_checkpointer()


async def run_forever() -> None:
    """Entrypoint for dedicated worker / projector containers."""
    from app.core.logging import configure_logging

    configure_logging()
    rt = BackgroundRuntime()
    await rt.start()
    try:
        await asyncio.Event().wait()
    finally:
        await rt.stop()
