import os
import time

import httpx
from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import get_settings
from app.database.session import session_scope
from app.events.bus import get_bus
from app.events.pubsub import RedisPubSub, get_pubsub

router = APIRouter(tags=["health"])


async def _db() -> dict:
    t0 = time.perf_counter()
    try:
        async with session_scope() as s:
            ver = (await s.execute(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'"))).scalar()
        return {"ok": True, "latency_ms": round((time.perf_counter() - t0) * 1000, 1), "pgvector": ver}
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}


@router.get("/health")
async def health() -> dict:
    db = await _db()
    return {"status": "ok" if db["ok"] else "degraded", "database": db["ok"]}


@router.get("/health/config")
async def config_status() -> dict:
    """What is configured, for the setup screen. Never returns secret values."""
    s = get_settings()
    ps = get_pubsub()
    llm: dict = {"provider": s.llm_provider, "model": s.llm_model, "configured": s.llm_configured}
    if s.llm_provider == "ollama":
        try:
            async with httpx.AsyncClient(timeout=2) as c:
                r = await c.get(f"{s.ollama_base_url}/api/tags")
            models = [m["name"] for m in r.json().get("models", [])]
            llm.update(reachable=True, model_available=any(m.startswith(s.llm_model) for m in models))
            llm["configured"] = llm["model_available"]
        except Exception:
            llm.update(reachable=False, configured=False)
    return {
        "app": s.app_name,
        "environment": s.environment,
        "run_mode": s.run_mode,
        "command_queue": s.command_queue if s.serverless else None,
        "commit": (os.environ.get("VERCEL_GIT_COMMIT_SHA") or "")[:7] or None,
        "llm": llm,
        "embeddings": {"provider": s.embedding_provider, "model": {"local": s.embedding_model, "openai": "text-embedding-3-small", "google": "gemini-embedding-001"}[s.embedding_provider], "dim": s.embedding_dim},
        "database": await _db(),
        "event_bus": {"kind": get_bus().name, "ok": await get_bus().healthy(), "bootstrap": s.kafka_bootstrap_servers if s.event_bus == "kafka" else None},
        "realtime": {"kind": "redis" if isinstance(ps, RedisPubSub) else "memory", "ok": await ps.healthy()},
        "limits": {
            "max_upload_mb": s.max_upload_mb,
            "run_timeout_seconds": s.run_timeout_seconds,
            "node_timeout_seconds": s.node_timeout_seconds,
            "node_max_attempts": s.node_max_attempts,
            "hard_max_revisions": s.hard_max_revisions,
            "run_token_budget": s.run_token_budget,
        },
    }
