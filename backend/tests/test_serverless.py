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
    yield from _serverless(monkeypatch, "inline")


@pytest.fixture
def serverless_stream(monkeypatch):
    yield from _serverless(monkeypatch, "stream")


def _serverless(monkeypatch, command_queue: str):
    s = get_settings()
    monkeypatch.setattr(s, "run_mode", "serverless")
    monkeypatch.setattr(s, "command_queue", command_queue)
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


async def test_stream_mode_ingests_in_the_request_and_runs_inside_the_live_stream(client, auth, llm, serverless_stream):
    """How it runs on Vercel: no background work, only work inside open requests."""
    r = await client.post("/api/v1/documents", headers=hdr(auth), files={"file": ("pilot.txt", DOC.encode(), "text/plain")})
    assert r.status_code == 202
    doc = (await client.get(f"/api/v1/documents/{r.json()['id']}", headers=hdr(auth))).json()["document"]
    assert doc["status"] == "ready"  # indexed before the upload request returned

    wf = await _workflow(client, auth, "Research brief")
    r = await client.post(f"/api/v1/workflows/{wf['id']}/runs", headers=hdr(auth), json={"task": "Summarise the pilot results"})
    run_id = r.json()["id"]
    assert (await client.get(f"/api/v1/runs/{run_id}", headers=hdr(auth))).json()["status"] == "queued"  # nothing ran yet

    stream = await client.get(f"/api/v1/runs/{run_id}/stream", headers=hdr(auth), timeout=60)  # the viewer drives the run
    assert "workflow.completed" in stream.text and "event: end" in stream.text
    run = (await client.get(f"/api/v1/runs/{run_id}", headers=hdr(auth))).json()
    assert run["status"] == "succeeded", run.get("error")
    assert [st["agent_type"] for st in run["steps"]] == ["research", "analyst", "reviewer"]


def test_hosted_postgres_urls_are_split_for_both_drivers():
    s = Settings(database_url="postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require")
    assert s.async_database_url == "postgresql+asyncpg://u:p@ep-x.neon.tech/db"
    assert s.async_connect_args == {"ssl": "require"}
    assert s.sync_database_url == "postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require"
    assert Settings(database_url="postgresql+asyncpg://u@localhost/db").async_connect_args == {}
