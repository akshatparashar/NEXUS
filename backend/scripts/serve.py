"""Run the API with uvicorn on any OS.

On Windows, psycopg's async driver (used by the LangGraph checkpointer) needs the selector event
loop, which uvicorn's CLI does not select. Docker/Linux can use `uvicorn app.main:app` directly.
"""

import asyncio
import os
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    config = uvicorn.Config(
        "app.main:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        loop="asyncio",
        proxy_headers=True,
        log_level="info",
    )
    asyncio.run(uvicorn.Server(config).serve())
