"""Document ingestion: parse → chunk → embed → store. Runs in the worker, triggered by Kafka."""

import asyncio
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete, update

from app.core.logging import get_logger
from app.database.session import session_scope
from app.events.emitter import emit_workspace_event
from app.events.envelope import DOCUMENT_STATUS
from app.events.outbox import nudge
from app.models import Chunk, Document
from app.rag.chunking import chunk_pages
from app.rag.embeddings import get_embedder
from app.rag.parsing import UnsupportedDocument, parse

log = get_logger(__name__)

EMBED_BATCH = 32


async def _status(doc_id: uuid.UUID, workspace_id: uuid.UUID, filename: str, **values) -> None:
    async with session_scope() as s:
        await s.execute(update(Document).where(Document.id == doc_id).values(**values))
        emit_workspace_event(
            s,
            DOCUMENT_STATUS,
            workspace_id,
            {
                "document_id": str(doc_id),
                "filename": filename,
                **{k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in values.items()},
            },
        )
    nudge()


async def ingest_document(doc_id: uuid.UUID) -> None:
    async with session_scope() as s:
        doc = await s.get(Document, doc_id)
        if doc is None:
            log.warning("ingest_missing_document", document_id=str(doc_id))
            return
        if doc.status == "ready":
            return
        ws, name, path, mime = doc.workspace_id, doc.filename, doc.storage_path, doc.mime

    try:
        await _status(doc_id, ws, name, status="parsing", progress=5, error=None)
        data = await asyncio.to_thread(Path(path).read_bytes)
        pages = await asyncio.to_thread(parse, data, mime)
        chunks = await asyncio.to_thread(chunk_pages, pages)
        await _status(doc_id, ws, name, status="embedding", progress=15, pages=len(pages) if mime == "application/pdf" else None)

        embedder = get_embedder()
        vectors: list[list[float]] = []
        for i in range(0, len(chunks), EMBED_BATCH):
            batch = chunks[i : i + EMBED_BATCH]
            vectors.extend(await embedder.embed_documents([c.content for c in batch]))
            pct = 15 + int(80 * min(len(chunks), i + EMBED_BATCH) / max(1, len(chunks)))
            await _status(doc_id, ws, name, progress=pct)

        async with session_scope() as s:
            await s.execute(delete(Chunk).where(Chunk.document_id == doc_id))
            s.add_all(
                Chunk(
                    document_id=doc_id,
                    workspace_id=ws,
                    ordinal=c.ordinal,
                    page=c.page,
                    content=c.content,
                    token_count=c.token_count,
                    embedding=v,
                )
                for c, v in zip(chunks, vectors, strict=True)
            )
        await _status(
            doc_id,
            ws,
            name,
            status="ready",
            progress=100,
            chunk_count=len(chunks),
            token_count=sum(c.token_count for c in chunks),
            ready_at=datetime.now(UTC),
        )
        log.info("document_ingested", document_id=str(doc_id), chunks=len(chunks))
    except UnsupportedDocument as e:
        await _status(doc_id, ws, name, status="failed", error=str(e))
    except Exception as e:
        log.exception("ingest_failed", document_id=str(doc_id))
        await _status(doc_id, ws, name, status="failed", error=f"Processing failed: {type(e).__name__}: {e}"[:500])
