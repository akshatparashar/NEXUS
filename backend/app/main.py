import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import auth, health, knowledge, monitoring, runs, workflows
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging, get_logger
from app.database.session import dispose_engine
from app.workers.runtime import BackgroundRuntime

log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    runtime = BackgroundRuntime()
    await runtime.start()
    app.state.runtime = runtime
    log.info("api_started", mode=get_settings().run_mode)
    try:
        yield
    finally:
        await runtime.stop()
        await dispose_engine()


def create_app(*, with_lifespan: bool = True) -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="NEXUS AI API",
        version="0.1.0",
        description=(
            "Agentic workflow platform. Draw a graph of AI agents, run it through LangGraph, "
            "follow it live over Server-Sent Events. Lifecycle events travel through Kafka."
        ),
        lifespan=lifespan if with_lifespan else None,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        structlog.contextvars.bind_contextvars(request_id=rid)
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.clear_contextvars()
        response.headers["x-request-id"] = rid
        return response

    install_error_handlers(app)
    api = APIRouter(prefix="/api/v1")
    for r in (health.router, auth.router, auth.ws_router, workflows.router, runs.router, knowledge.router, monitoring.router):
        api.include_router(r)
    app.include_router(api)
    return app


app = create_app()
