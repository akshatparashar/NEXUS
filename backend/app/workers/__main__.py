"""``python -m app.workers`` runs the role given by RUN_MODE (worker or projector)."""

import asyncio
import sys

from app.workers.runtime import run_forever

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())  # psycopg async needs it
    asyncio.run(run_forever())
