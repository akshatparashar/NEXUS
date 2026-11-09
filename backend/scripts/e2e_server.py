"""The real API with one test double: an extractive, deterministic LLM (tests/extractive_llm.py).

Used by the Playwright end-to-end suite and for screenshots when no API key is available. Every
other part is production code: Postgres + pgvector, local embeddings, LangGraph, the outbox, the
consumers and SSE. Never use this to serve real users.

    uv run python scripts/e2e_server.py        # API on :8000, database "nexus_e2e"
"""

import asyncio
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _database_url() -> str:
    if os.environ.get("E2E_DATABASE_URL"):
        return os.environ["E2E_DATABASE_URL"]
    import pgserver

    srv = pgserver.get_server(str(ROOT / ".pgdata"), cleanup_mode=None)
    if os.environ.get("E2E_RESET", "1") == "1":
        srv.psql("DROP DATABASE IF EXISTS nexus_e2e WITH (FORCE);")
        srv.psql("CREATE DATABASE nexus_e2e;")
    return srv.get_uri().rsplit("/", 1)[0].replace("postgresql://", "postgresql+asyncpg://") + "/nexus_e2e"


if __name__ == "__main__":
    os.environ["DATABASE_URL"] = _database_url()
    os.environ.setdefault("OPENAI_API_KEY", "e2e-extractive-double")
    os.environ.setdefault("LLM_MODEL", "extractive-test-double")
    os.environ.setdefault("RUN_MODE", "embedded")
    os.environ.setdefault("EVENT_BUS", "memory")
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=ROOT, check=True)

    import uvicorn

    from app.agents.llm import set_llm
    from tests.extractive_llm import ExtractiveLLM

    set_llm(ExtractiveLLM(pace=float(os.environ.get("E2E_PACE", "0.015"))))
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    config = uvicorn.Config("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), loop="asyncio", log_level="warning")
    asyncio.run(uvicorn.Server(config).serve())
