import asyncio
import json
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from fastapi import APIRouter, File, UploadFile, status
from sqlalchemy import select
from sse_starlette.sse import EventSourceResponse

from app.agents import prompts
from app.agents.llm import Usage, get_llm
from app.core.config import get_settings
from app.core.deps import CurrentUser, CurrentWorkspace, SessionDep, rate_limit
from app.core.errors import NotFound
from app.database.session import session_scope
from app.models import Chunk, Document
from app.rag.retrieval import format_context, hybrid_search
from app.schemas import AskIn, ChatIn, DocumentOut, SearchIn
from app.services import document_service

router = APIRouter(tags=["knowledge"])


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(session: SessionDep, ws: CurrentWorkspace) -> list[Document]:
    rows = await session.execute(select(Document).where(Document.workspace_id == ws.id).order_by(Document.created_at.desc()))
    return list(rows.scalars().all())


@router.post("/documents", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    session: SessionDep, ws: CurrentWorkspace, user: CurrentUser, file: UploadFile = File(...)
) -> Document:
    """Upload a PDF, TXT or Markdown file (max ``MAX_UPLOAD_MB``). Processing continues in the worker."""
    return await document_service.upload(session, ws, user, file)


@router.get("/documents/{doc_id}")
async def get_document(doc_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace) -> dict:
    doc = (
        await session.execute(select(Document).where(Document.id == doc_id, Document.workspace_id == ws.id))
    ).scalars().first()
    if doc is None:
        raise NotFound("Document not found.")
    chunks = (
        await session.execute(
            select(Chunk.id, Chunk.ordinal, Chunk.page, Chunk.token_count, Chunk.content)
            .where(Chunk.document_id == doc.id)
            .order_by(Chunk.ordinal)
            .limit(200)
        )
    ).all()
    return {
        "document": DocumentOut.model_validate(doc).model_dump(mode="json"),
        "chunks": [
            {"id": str(c.id), "ordinal": c.ordinal, "page": c.page, "token_count": c.token_count, "content": c.content}
            for c in chunks
        ],
    }


@router.delete("/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(doc_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace) -> None:
    await document_service.remove(session, ws, doc_id)


@router.post("/documents/{doc_id}/reprocess", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED)
async def reprocess_document(doc_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace) -> Document:
    return await document_service.reprocess(session, ws, doc_id)


@router.post("/search")
async def search(body: SearchIn, session: SessionDep, ws: CurrentWorkspace) -> dict:
    """Hybrid retrieval (vector + full-text, fused with Reciprocal Rank Fusion)."""
    hits = await hybrid_search(session, ws.id, body.query, k=body.k)
    return {"query": body.query, "results": [h.as_dict() for h in hits]}


ASK_SYSTEM = prompts.BASE + """

Answer the question using only the numbered passages. Cite every factual sentence with [n].
If the passages do not contain the answer, say so in one sentence and suggest what document
would help. Keep it concise: a direct answer first, then supporting detail."""


async def _relay(call: Callable[[Callable[[str], Awaitable[None]]], Awaitable[tuple[str, Usage]]]) -> AsyncIterator[tuple[str, Any]]:
    """Run an LLM call in a task and yield ("token", text) deltas, then ("done", (text, usage)) or ("error", msg)."""
    q: asyncio.Queue = asyncio.Queue()

    async def push(t: str) -> None:
        await q.put(("token", t))

    async def run() -> None:
        try:
            await q.put(("done", await call(push)))
        except Exception as e:  # surface provider errors to the client instead of dropping the stream
            await q.put(("error", getattr(e, "message", None) or str(e)))

    task = asyncio.create_task(run())
    try:
        while True:
            kind, val = await q.get()
            yield kind, val
            if kind != "token":
                return
    finally:
        task.cancel()


@router.post("/ask", dependencies=[rate_limit("ask", "rate_limit_ask")])
async def ask(body: AskIn, session: SessionDep, ws: CurrentWorkspace) -> EventSourceResponse:
    """Grounded answer, streamed. Emits ``sources`` first, then ``token`` deltas, then ``done``."""
    llm = get_llm()
    hits = await hybrid_search(session, ws.id, body.question, k=body.k)

    async def gen():
        yield {"event": "sources", "data": json.dumps([{**h.as_dict(), "n": i} for i, h in enumerate(hits, 1)])}
        if not hits:
            msg = "The knowledge base has nothing on this yet. Add a document that covers it and ask again."
            yield {"event": "token", "data": json.dumps({"text": msg})}
            yield {"event": "done", "data": json.dumps({"cited": []})}
            return
        user = f"Question: {body.question}\n\nPassages:\n{format_context(hits)}"
        messages = [{"role": "system", "content": ASK_SYSTEM}, {"role": "user", "content": user}]
        async for kind, val in _relay(lambda push: llm.chat(messages, on_delta=push)):
            if kind == "token":
                yield {"event": "token", "data": json.dumps({"text": val})}
            elif kind == "error":
                yield {"event": "error", "data": json.dumps({"message": val})}
            else:
                text, usage = val
                cited = sorted({int(n) for n in re.findall(r"\[(\d+)\]", text) if 1 <= int(n) <= len(hits)})
                done = {"cited": cited, "tokens_in": usage.input_tokens, "tokens_out": usage.output_tokens}
                yield {"event": "done", "data": json.dumps(done)}

    return EventSourceResponse(gen(), headers={"X-Accel-Buffering": "no"})


@router.post("/agents/{agent_type}/chat", dependencies=[rate_limit("ask", "rate_limit_ask")])
async def agent_chat(agent_type: str, body: ChatIn, ws: CurrentWorkspace) -> EventSourceResponse:
    """Agent Playground: talk to one agent directly. Research and Analyst search the knowledge base first."""
    if agent_type not in prompts.PLAYGROUND:
        raise NotFound("Unknown agent.")
    llm = get_llm()
    model = get_settings().llm_model

    async def gen():
        system = prompts.PLAYGROUND[agent_type] + (
            "\n\nYou are in a one-to-one conversation in the Agent Playground. Reply conversationally in Markdown."
        )
        last_user = next((m.content for m in reversed(body.messages) if m.role == "user"), "")
        if body.use_knowledge and agent_type in ("research", "analyst"):
            args = {"query": last_user[:200]}
            yield {"event": "tool", "data": json.dumps({"tool": "kb_search", "status": "running", "args": args})}
            async with session_scope() as sess:
                hits = await hybrid_search(sess, ws.id, last_user, k=6)
            results = [{**h.as_dict(), "n": i} for i, h in enumerate(hits, 1)]
            yield {"event": "tool", "data": json.dumps({"tool": "kb_search", "status": "done", "args": args, "results": results})}
            system += "\n\nNumbered passages from the knowledge base (cite as [n]):\n" + format_context(hits)
        messages = [{"role": "system", "content": system}] + [m.model_dump() for m in body.messages]
        async for kind, val in _relay(lambda push: llm.chat(messages, on_delta=push)):
            if kind == "token":
                yield {"event": "token", "data": json.dumps({"text": val})}
            elif kind == "error":
                yield {"event": "error", "data": json.dumps({"message": val})}
            else:
                _, usage = val
                done = {"tokens_in": usage.input_tokens, "tokens_out": usage.output_tokens, "model": model}
                yield {"event": "done", "data": json.dumps(done)}

    return EventSourceResponse(gen(), headers={"X-Accel-Buffering": "no"})
