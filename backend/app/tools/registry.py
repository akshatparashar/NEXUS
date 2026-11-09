"""Tools the Execution agent may call.

Every tool is on an explicit allowlist. Tools marked ``destructive`` never run without a person
approving them first: the orchestration layer pauses the run with a LangGraph ``interrupt()`` and
resumes only after a decision is recorded.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy import delete, select

from app.core.config import get_settings
from app.database.session import session_scope
from app.models import Chunk, Document, RunArtifact
from app.rag.retrieval import hybrid_search


@dataclass
class ToolContext:
    workspace_id: uuid.UUID
    run_id: uuid.UUID
    node_id: str


@dataclass
class Tool:
    name: str
    description: str
    params: dict[str, str]
    run: Callable[[ToolContext, dict[str, Any]], Awaitable[dict[str, Any]]]
    destructive: bool = False
    available: Callable[[], bool] = field(default=lambda: True)

    def signature(self) -> str:
        args = ", ".join(f"{k}: {v}" for k, v in self.params.items())
        flag = " [REQUIRES HUMAN APPROVAL]" if self.destructive else ""
        return f"- {self.name}({args}){flag}: {self.description}"


class ToolError(Exception):
    pass


def _require(args: dict, *names: str) -> None:
    missing = [n for n in names if not str(args.get(n, "")).strip()]
    if missing:
        raise ToolError(f"Missing argument(s): {', '.join(missing)}")


async def _kb_search(ctx: ToolContext, args: dict) -> dict:
    _require(args, "query")
    async with session_scope() as s:
        hits = await hybrid_search(s, ctx.workspace_id, str(args["query"]), k=int(args.get("k", 5)))
    return {
        "results": [
            {"ref": h.ref, "chunk_id": h.chunk_id, "score": h.score, "excerpt": h.content[:400]} for h in hits
        ]
    }


async def _http_get(ctx: ToolContext, args: dict) -> dict:
    _require(args, "url")
    url = str(args["url"])
    parsed = urlparse(url)
    allow = get_settings().http_tool_allowlist
    if parsed.scheme != "https" or (parsed.hostname or "") not in allow:
        raise ToolError(f"Only https URLs on these hosts are allowed: {', '.join(allow)}")
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        r = await client.get(url, headers={"User-Agent": "NEXUS-AI/0.1"})
    body = r.text[:200_000]
    return {"status": r.status_code, "content_type": r.headers.get("content-type", ""), "text": body[:4000]}


async def _save_report(ctx: ToolContext, args: dict) -> dict:
    _require(args, "title", "content")
    async with session_scope() as s:
        art = RunArtifact(
            run_id=ctx.run_id,
            node_id=ctx.node_id,
            kind="report",
            title=str(args["title"])[:200],
            content=str(args["content"]),
        )
        s.add(art)
        await s.flush()
        return {"artifact_id": str(art.id), "title": art.title, "chars": len(art.content)}


async def _send_webhook(ctx: ToolContext, args: dict) -> dict:
    _require(args, "url", "message")
    url = str(args["url"])
    if url not in get_settings().webhook_urls:
        raise ToolError("This webhook URL is not in WEBHOOK_URLS.")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, json={"text": str(args["message"]), "run_id": str(ctx.run_id)})
    return {"status": r.status_code}


async def _delete_document(ctx: ToolContext, args: dict) -> dict:
    _require(args, "filename")
    name = str(args["filename"])
    async with session_scope() as s:
        doc = (
            await s.execute(
                select(Document).where(Document.workspace_id == ctx.workspace_id, Document.filename == name)
            )
        ).scalars().first()
        if doc is None:
            raise ToolError(f"No document named {name!r} in this workspace.")
        await s.execute(delete(Chunk).where(Chunk.document_id == doc.id))
        await s.delete(doc)
    return {"deleted": name}


TOOLS: dict[str, Tool] = {
    t.name: t
    for t in [
        Tool(
            "kb_search",
            "Search the workspace knowledge base. Returns ranked passages with references.",
            {"query": "str"},
            _kb_search,
        ),
        Tool(
            "http_get",
            "Fetch a public https page from an allowlisted host and return its text.",
            {"url": "str"},
            _http_get,
        ),
        Tool(
            "save_report",
            "Save a Markdown report as an artifact of this run so people can read or download it.",
            {"title": "str", "content": "markdown str"},
            _save_report,
        ),
        Tool(
            "send_webhook",
            "POST a message to a configured webhook (for example a Slack incoming webhook).",
            {"url": "str", "message": "str"},
            _send_webhook,
            destructive=True,
            available=lambda: bool(get_settings().webhook_urls),
        ),
        Tool(
            "delete_document",
            "Permanently delete a document and its chunks from the knowledge base.",
            {"filename": "str"},
            _delete_document,
            destructive=True,
        ),
    ]
}


def available_tools(allowed: list[str] | None) -> list[Tool]:
    names = allowed or list(TOOLS)
    return [TOOLS[n] for n in names if n in TOOLS and TOOLS[n].available()]
