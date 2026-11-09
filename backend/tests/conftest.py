"""Test harness: real PostgreSQL 16 + pgvector, real LangGraph, real outbox/consumers.

The broker is the in-memory bus (same consumer-group contract as Kafka), the embedder is a
deterministic hash embedding, and the LLM is scripted. Everything else is the production code path.

Postgres comes from ``TEST_DATABASE_URL`` if set (CI / Docker), otherwise from an embedded
``pgserver`` instance started on demand.
"""

import asyncio
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        return url
    import pgserver

    srv = pgserver.get_server(str(ROOT / ".pgdata"), cleanup_mode=None)
    srv.psql("DROP DATABASE IF EXISTS nexus_test WITH (FORCE);")
    srv.psql("CREATE DATABASE nexus_test;")
    return srv.get_uri().rsplit("/", 1)[0].replace("postgresql://", "postgresql+asyncpg://") + "/nexus_test"


DB_URL = _database_url()
os.environ.update(
    {
        "ENVIRONMENT": "test",
        "DATABASE_URL": DB_URL,
        "EVENT_BUS": "memory",
        "RUN_MODE": "embedded",
        "REDIS_URL": "",
        "LLM_PROVIDER": "openai",
        "OPENAI_API_KEY": "test-key-not-used",
        "UPLOAD_DIR": tempfile.mkdtemp(prefix="nexus-uploads-"),
        "NODE_TIMEOUT_SECONDS": "20",
        "RATE_LIMIT_AUTH": "1000",
        "RATE_LIMIT_RUNS": "1000",
        "RATE_LIMIT_ASK": "1000",
        "LOG_LEVEL": "WARNING",
    }
)
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=ROOT, check=True, env=os.environ.copy())

from app.agents.llm import set_llm  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.rag.embeddings import set_embedder  # noqa: E402
from tests.fakes import HashEmbedder, ScriptedLLM  # noqa: E402

get_settings.cache_clear()
assert get_settings().redis_url in (None, "")


def pytest_asyncio_loop_factories(config, item):
    # psycopg's async driver (LangGraph checkpointer) cannot run on Windows' default Proactor loop.
    if sys.platform == "win32":
        return {"selector": asyncio.SelectorEventLoop}
    return {"asyncio": asyncio.new_event_loop}


@pytest.fixture(scope="session")
def llm() -> ScriptedLLM:
    return ScriptedLLM()


@pytest.fixture(autouse=True)
def _reset_llm(llm: ScriptedLLM):
    llm.reset()
    yield


@pytest.fixture(scope="session")
async def runtime(llm: ScriptedLLM):
    from app.workers.runtime import BackgroundRuntime

    set_llm(llm)
    set_embedder(HashEmbedder())
    rt = BackgroundRuntime()
    await rt.start()
    yield rt
    await rt.stop()


@pytest.fixture(scope="session")
async def app(runtime):
    from app.main import create_app

    return create_app(with_lifespan=False)


@pytest.fixture
async def client(app):
    import httpx

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict:
    """A fresh user with their own workspace. Returns headers for authenticated calls."""
    email = f"user-{uuid.uuid4().hex[:10]}@example.com"
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": "correct horse", "name": "Ada Lovelace"})
    assert r.status_code == 201, r.text
    body = r.json()
    return {
        "Authorization": f"Bearer {body['access_token']}",
        "X-Workspace-Id": body["workspaces"][0]["id"],
        "_email": email,
    }


def hdr(auth: dict) -> dict:
    return {k: v for k, v in auth.items() if not k.startswith("_")}


async def wait_for(predicate, timeout: float = 30.0, interval: float = 0.1):
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        result = await predicate()
        if result:
            return result
        if asyncio.get_event_loop().time() > deadline:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(interval)


async def wait_run(client, auth, run_id: str, statuses=("succeeded", "failed", "cancelled", "timed_out", "awaiting_approval"), timeout=40.0) -> dict:
    async def check():
        r = await client.get(f"/api/v1/runs/{run_id}", headers=hdr(auth))
        data = r.json()
        return data if data["status"] in statuses else None

    return await wait_for(check, timeout)


async def upload_text(client, auth, name: str, text: str) -> dict:
    r = await client.post(
        "/api/v1/documents",
        headers=hdr(auth),
        files={"file": (name, text.encode(), "text/plain")},
    )
    assert r.status_code == 202, r.text
    doc = r.json()

    async def ready():
        d = (await client.get(f"/api/v1/documents/{doc['id']}", headers=hdr(auth))).json()["document"]
        return d if d["status"] in ("ready", "failed") else None

    return await wait_for(ready)
