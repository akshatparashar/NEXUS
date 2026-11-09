import asyncio
import hashlib
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, Conflict, NotFound, ValidationFailed
from app.events import envelope as ev
from app.events.envelope import EventEnvelope
from app.events.outbox import enqueue, nudge
from app.models import Chunk, Document, User, Workspace
from app.rag.parsing import UnsupportedDocument, sniff_type


class PayloadTooLarge(AppError):
    status_code = 413
    code = "file_too_large"


async def upload(session: AsyncSession, ws: Workspace, user: User, file: UploadFile) -> Document:
    s = get_settings()
    limit = s.max_upload_mb * 1024 * 1024
    filename = Path(file.filename or "document").name[:255]

    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        data.extend(chunk)
        if len(data) > limit:
            raise PayloadTooLarge(f"Files can be at most {s.max_upload_mb} MB.")
    if not data:
        raise ValidationFailed("The file is empty.")
    try:
        mime = sniff_type(filename, bytes(data[:8192]))
    except UnsupportedDocument as e:
        raise ValidationFailed(str(e), code="unsupported_file") from e

    sha = hashlib.sha256(data).hexdigest()
    existing = (
        await session.execute(select(Document).where(Document.workspace_id == ws.id, Document.sha256 == sha))
    ).scalars().first()
    if existing:
        raise Conflict(f"This file is already in the knowledge base as {existing.filename}.", code="duplicate_document")

    doc_id = uuid.uuid4()
    folder = Path(s.upload_dir) / str(ws.id)
    path = folder / f"{doc_id}{Path(filename).suffix.lower()}"
    await asyncio.to_thread(folder.mkdir, parents=True, exist_ok=True)
    await asyncio.to_thread(path.write_bytes, bytes(data))

    doc = Document(
        id=doc_id,
        workspace_id=ws.id,
        filename=filename,
        mime=mime,
        size_bytes=len(data),
        sha256=sha,
        storage_path=str(path.resolve()),
        status="uploaded",
        uploaded_by=user.id,
    )
    session.add(doc)
    enqueue(
        session,
        ev.COMMANDS,
        EventEnvelope(type=ev.DOCUMENT_UPLOADED, workspace_id=ws.id, payload={"document_id": str(doc_id), "filename": filename}),
    )
    await session.commit()
    nudge()
    return doc


async def remove(session: AsyncSession, ws: Workspace, doc_id: uuid.UUID) -> None:
    doc = (
        await session.execute(select(Document).where(Document.id == doc_id, Document.workspace_id == ws.id))
    ).scalars().first()
    if doc is None:
        raise NotFound("Document not found.")
    path = Path(doc.storage_path)
    await session.execute(delete(Chunk).where(Chunk.document_id == doc.id))
    await session.delete(doc)
    await session.commit()
    await asyncio.to_thread(path.unlink, missing_ok=True)


async def reprocess(session: AsyncSession, ws: Workspace, doc_id: uuid.UUID) -> Document:
    doc = (
        await session.execute(select(Document).where(Document.id == doc_id, Document.workspace_id == ws.id))
    ).scalars().first()
    if doc is None:
        raise NotFound("Document not found.")
    if doc.status not in ("failed",):
        raise Conflict("Only failed documents can be processed again.")
    doc.status, doc.progress, doc.error = "uploaded", 0, None
    enqueue(
        session,
        ev.COMMANDS,
        EventEnvelope(type=ev.DOCUMENT_UPLOADED, workspace_id=ws.id, payload={"document_id": str(doc.id), "filename": doc.filename}),
    )
    await session.commit()
    nudge()
    return doc
