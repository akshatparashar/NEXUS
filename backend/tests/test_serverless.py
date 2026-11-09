"""The serverless code path (RUN_MODE=serverless), as it runs on Vercel, minus the Vercel queue.

COMMAND_QUEUE=inline runs each queued command in-process exactly as the queue consumer would,
so this covers: requests flushing the outbox themselves, lifecycle events projected inline,
uploads stored in Postgres, token coalescing, and the URL handling for hosted Postgres.
"""

import pytest
from sqlalchemy import select

from app.core.config import Settings, get_settings
from app.database.session import session_scope
from app.events.bus import ServerlessBus, get_bus, set_bus
from app.models import Document
from tests.conftest import hdr, upload_text, wait_run
from tests.test_runs import DOC, _workflow


@pytest.fixture
def serverless(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "run_mode", "serverless")
    monkeypatch.setattr(s, "command_queue", "inline")
    monkeypatch.setattr(s, "upload_storage", "database")
    monkeypatch.setattr(s, "token_flush_ms", 50)
    previous = get_bus()
    bus = ServerlessBus()
    set_bus(bus)
    yield bus
    set_bus(previous)


async def test_serverless_mode_runs_a_workflow_end_to_end(client, auth, llm, serverless):
    doc = await upload_text(client, auth, "pilot.txt", DOC)
    assert doc["status"] == "ready"
    async with session_scope() as s:
        row = (await s.execute(select(Document.storage_path, Document.content).where(Document.id == doc["id"]))).one()
    assert row.storage_path.startswith("db://") and row.content == DOC.encode()

    wf = await _workflow(client, auth, "Research brief")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Summarise the pilot results"})
    assert r.status_code == 202
    run = await wait_run(client, auth, r.json()["id"])
    assert run["status"] == "succeeded", run.get("error")
    assert [st["agent_type"] for st in run["steps"]] == ["research", "analyst", "reviewer"]

    events = (await client.get(f"/api/v1/runs/{run['id']}/events", headers=hdr(auth))).json()
    kinds = [e["type"] for e in events]
    assert kinds[0] == "workflow.started" and kinds[-1] == "workflow.completed"
    assert serverless.stats["nexus.commands"].produced >= 2  # the ingest and the run went through the queue path


def test_hosted_postgres_urls_are_split_for_both_drivers():
    s = Settings(database_url="postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require")
    assert s.async_database_url == "postgresql+asyncpg://u:p@ep-x.neon.tech/db"
    assert s.async_connect_args == {"ssl": "require"}
    assert s.sync_database_url == "postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require"
    assert Settings(database_url="postgresql+asyncpg://u@localhost/db").async_connect_args == {}
