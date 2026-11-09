from functools import lru_cache
from typing import Any, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_LIBPQ_ONLY = {"sslmode", "channel_binding", "sslrootcert", "sslcert", "sslkey", "options", "target_session_attrs"}


class Settings(BaseSettings):
    """All runtime configuration. Values come from environment variables or `.env`."""

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    app_name: str = "NEXUS AI"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    log_json: bool = False

    # Process topology. "embedded" runs the outbox relay, worker and projector inside the API
    # process (handy without Docker). In Compose each role runs as its own container.
    # "serverless" (Vercel) runs no background loops: requests flush the outbox themselves,
    # commands go to a queue whose consumer runs each run to completion, and lifecycle events
    # are projected in the process that produced them.
    run_mode: Literal["embedded", "api", "worker", "projector", "serverless"] = "embedded"
    # serverless only, where work happens while a request is open:
    #   "stream" (default): uploads and cancels finish before their request returns; a run executes
    #             inside its own live stream (/runs/{id}/stream), which the UI opens right away
    #   "inline": a background task in the receiving process (fine on a long-lived local server)
    #   "vercel": Vercel Queues with a separate consumer function
    command_queue: Literal["stream", "inline", "vercel"] = "stream"
    queue_topic: str = "nexus-commands"

    database_url: str = "postgresql+asyncpg://nexus:nexus@localhost:5432/nexus"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    redis_url: str | None = None
    event_bus: Literal["kafka", "memory"] = "memory"
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_client_id: str = "nexus"

    # Auth
    jwt_secret: str = "change-me-in-production-please-32b"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 14
    cookie_secure: bool = False

    cors_origins: list[str] = ["http://localhost:3000"]

    # LLM
    llm_provider: Literal["openai", "anthropic", "google", "ollama"] = "openai"
    llm_model: str = "gpt-4.1-mini"
    llm_temperature: float = 0.2
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    anthropic_api_key: str | None = None
    google_api_key: str | None = None  # Gemini (Google AI Studio)
    # cap on each model reply; keeps free-tier quotas (Gemini) and costs predictable
    llm_max_output_tokens: int = 4096
    ollama_base_url: str = "http://localhost:11434"

    # Embeddings: "local" runs BAAI/bge-small-en-v1.5 on CPU through fastembed and needs no key.
    embedding_provider: Literal["local", "openai", "google"] = "local"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384
    model_cache_dir: str = ".models"

    # Uploads
    upload_dir: str = "uploads"
    # "database" keeps file bytes in Postgres, for hosts without a shared disk (serverless)
    upload_storage: Literal["disk", "database"] = "disk"
    max_upload_mb: int = 20

    # Execution guards
    run_timeout_seconds: int = 600
    node_timeout_seconds: int = 120
    node_max_attempts: int = 3
    default_max_revisions: int = 2
    hard_max_revisions: int = 5
    max_concurrent_runs: int = 4
    run_token_budget: int = 200_000
    lease_stale_seconds: int = 45

    # Tools
    http_tool_allowlist: list[str] = Field(
        default_factory=lambda: ["en.wikipedia.org", "api.github.com", "raw.githubusercontent.com"]
    )
    webhook_urls: list[str] = Field(default_factory=list)

    # Rate limits (requests per minute)
    rate_limit_auth: int = 20
    rate_limit_runs: int = 30
    rate_limit_ask: int = 60

    # Token deltas are coalesced for this many ms before publishing (0 = every token). Saves
    # commands on metered Redis such as Upstash.
    token_flush_ms: int = 0

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    @property
    def sync_database_url(self) -> str:
        """Plain libpq URL (used by the LangGraph checkpointer and Alembic). Keeps sslmode."""
        return self.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)

    @property
    def async_database_url(self) -> str:
        """The asyncpg URL without libpq-only query options (sslmode, channel_binding, ...).

        Hosted Postgres (Neon, Supabase) hands out URLs with ``?sslmode=require``, which asyncpg
        rejects; TLS is passed through :attr:`async_connect_args` instead.
        """
        parts = urlsplit(self.database_url)
        keep = [(k, v) for k, v in parse_qsl(parts.query) if k not in _LIBPQ_ONLY]
        return urlunsplit(parts._replace(query=urlencode(keep)))

    @property
    def async_connect_args(self) -> dict[str, Any]:
        mode = dict(parse_qsl(urlsplit(self.database_url).query)).get("sslmode")
        return {"ssl": "require"} if mode in ("require", "verify-ca", "verify-full") else {}

    @property
    def serverless(self) -> bool:
        return self.run_mode == "serverless"

    @property
    def llm_configured(self) -> bool:
        if self.llm_provider == "openai":
            return bool(self.openai_api_key)
        if self.llm_provider == "anthropic":
            return bool(self.anthropic_api_key)
        if self.llm_provider == "google":
            return bool(self.google_api_key)
        return True  # ollama needs no key; reachability is checked by /health/config

    @property
    def runs_workers(self) -> bool:
        return self.run_mode in ("embedded", "worker")

    @property
    def runs_projector(self) -> bool:
        return self.run_mode in ("embedded", "projector")

    @property
    def runs_relay(self) -> bool:
        return self.run_mode in ("embedded", "api")


@lru_cache
def get_settings() -> Settings:
    return Settings()
