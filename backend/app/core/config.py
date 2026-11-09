from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration. Values come from environment variables or `.env`."""

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    app_name: str = "NEXUS AI"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    log_json: bool = False

    # Process topology. "embedded" runs the outbox relay, worker and projector inside the API
    # process (handy without Docker). In Compose each role runs as its own container.
    run_mode: Literal["embedded", "api", "worker", "projector"] = "embedded"

    database_url: str = "postgresql+asyncpg://nexus:nexus@localhost:5432/nexus"
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
    llm_provider: Literal["openai", "anthropic", "ollama"] = "openai"
    llm_model: str = "gpt-4.1-mini"
    llm_temperature: float = 0.2
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    anthropic_api_key: str | None = None
    ollama_base_url: str = "http://localhost:11434"

    # Embeddings: "local" runs BAAI/bge-small-en-v1.5 on CPU through fastembed and needs no key.
    embedding_provider: Literal["local", "openai"] = "local"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384
    model_cache_dir: str = ".models"

    # Uploads
    upload_dir: str = "uploads"
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

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    @property
    def sync_database_url(self) -> str:
        """Plain libpq URL (used by the LangGraph checkpointer and Alembic)."""
        return self.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)

    @property
    def llm_configured(self) -> bool:
        if self.llm_provider == "openai":
            return bool(self.openai_api_key)
        if self.llm_provider == "anthropic":
            return bool(self.anthropic_api_key)
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
