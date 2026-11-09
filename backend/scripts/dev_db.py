"""Start an embedded PostgreSQL 16 + pgvector for local development without Docker.

Usage:  uv run python scripts/dev_db.py            # prints DATABASE_URL
        uv run python scripts/dev_db.py --stop

The server keeps running after this script exits, so the API, the tests and Alembic can share it.
Docker Compose users never need this; Compose runs the `pgvector/pgvector` image instead.
"""

import sys
from pathlib import Path

import pgserver

DATA_DIR = Path(__file__).resolve().parents[1] / ".pgdata"


def main() -> None:
    server = pgserver.get_server(str(DATA_DIR), cleanup_mode=None)
    if "--stop" in sys.argv:
        server.cleanup()
        print("stopped")
        return
    server.psql("CREATE EXTENSION IF NOT EXISTS vector;")
    exists = server.psql("SELECT 1 FROM pg_database WHERE datname = 'nexus';")
    if "1 row" not in exists:
        server.psql("CREATE DATABASE nexus;")
    server.psql("CREATE DATABASE nexus_test;") if "1 row" not in server.psql(
        "SELECT 1 FROM pg_database WHERE datname = 'nexus_test';"
    ) else None
    base = server.get_uri().rsplit("/", 1)[0]
    print(f"{base}/nexus".replace("postgresql://", "postgresql+asyncpg://"))


if __name__ == "__main__":
    main()
