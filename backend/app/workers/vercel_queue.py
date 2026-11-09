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


async def handle_command(raw: bytes | str | dict[str, Any]) -> None:
    """Run one command envelope: bytes or a JSON string as stored in the outbox, or its decoded dict."""
    if isinstance(raw, bytes):
        value = raw
    elif isinstance(raw, str):
        value = raw.encode()
    else:
        value = json.dumps(raw).encode()
    await _get_consumer()(COMMANDS, value)


async def drive_run(run_id: Any, max_commands: int = 5) -> None:
    """COMMAND_QUEUE=stream: execute this run's not-yet-processed commands, in order, right here.

    Called from the run's live stream. Duplicates are harmless: the consumer ledger lets one caller
    take a command, and the run lease stops two processes executing one run.
    """
    from sqlalchemy import text

    from app.database.session import session_scope

    tried: set[str] = set()
    for _ in range(max_commands):
        async with session_scope() as s:
            rows = (
                await s.execute(
                    text(
                        "SELECT o.event_id::text AS id, o.payload FROM outbox o "
                        "WHERE o.topic = :topic AND o.key = :key AND NOT EXISTS ("
                        "  SELECT 1 FROM processed_events p WHERE p.consumer = :consumer AND p.event_id = o.event_id"
                        ") ORDER BY o.id"
                    ),
                    {"topic": COMMANDS, "key": str(run_id), "consumer": CommandConsumer.name},
                )
            ).all()
        pending = [r for r in rows if r.id not in tried]
        if not pending:
            return
        tried.add(pending[0].id)
        await handle_command(pending[0].payload)


try:  # the Vercel SDK is only needed where the queue exists
    from vercel.queue import Message, subscribe
except ImportError:  # pragma: no cover - local development without the SDK
    subscribe = None

if subscribe is not None:

    @subscribe(topic=get_settings().queue_topic, max_attempts=3)
    async def on_command(message: "Message[dict[str, Any]]") -> None:
        log.info("queue_command_received", message_id=message.message_id)
        await handle_command(message.payload)
