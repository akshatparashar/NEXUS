"""The ``nexus.commands`` consumer for serverless hosts (``RUN_MODE=serverless``).

On Vercel this module is declared under ``[[tool.vercel.subscribers]]`` in ``pyproject.toml``;
the build turns the ``@subscribe`` function into a private, queue-triggered Vercel Function.
Each delivery runs one command to completion: a run executes until it finishes, fails, times out
or pauses for an approval (approvals resume through a new ``workflow.run.resume`` command).

Durability is the same as with Kafka: the command is idempotent (the consumer ledger skips
duplicates and the run lease stops two workers running one run), progress is checkpointed after
every step, and a run whose worker vanished is re-queued with ``mode=recover`` the next time
someone opens it (see ``run_service.kick_if_stale``).
"""

import json
from typing import Any

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.events.envelope import COMMANDS
from app.workers.command_consumer import CommandConsumer
from app.workers.run_executor import RunExecutor

log = get_logger(__name__)

_consumer: CommandConsumer | None = None


def _get_consumer() -> CommandConsumer:
    global _consumer
    if _consumer is None:
        configure_logging()
        _consumer = CommandConsumer(RunExecutor(), inline=True)
    return _consumer


async def handle_command(raw: bytes | dict[str, Any]) -> None:
    """Run one command envelope (bytes as stored in the outbox, or its decoded JSON)."""
    value = raw if isinstance(raw, bytes) else json.dumps(raw).encode()
    await _get_consumer()(COMMANDS, value)


try:  # the Vercel SDK is only needed where the queue exists
    from vercel.queue import Message, subscribe
except ImportError:  # pragma: no cover - local development without the SDK
    subscribe = None

if subscribe is not None:

    @subscribe(topic=get_settings().queue_topic, max_attempts=3)
    async def on_command(message: "Message[dict[str, Any]]") -> None:
        log.info("queue_command_received", message_id=message.message_id)
        await handle_command(message.payload)
