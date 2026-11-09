"""Hybrid retrieval: pgvector cosine similarity + Postgres full-text search, fused with RRF."""

import uuid
from dataclasses import asdict, dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.rag.embeddings import get_embedder

RRF_K = 60


@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    filename: str
    page: int | None
    ordinal: int
    content: str
    score: float  # fused RRF score
    similarity: float | None  # cosine similarity, when the vector arm found it
    vector_rank: int | None
    keyword_rank: int | None

    def as_dict(self) -> dict:
        return asdict(self)

    @property
    def ref(self) -> str:
        loc = f", p.{self.page}" if self.page else ""
        return f"{self.filename}{loc}"


VECTOR_SQL = text(
    """
    SELECT c.id, 1 - (c.embedding <=> CAST(:qvec AS vector)) AS similarity
    FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE c.workspace_id = :ws AND d.status = 'ready'
    ORDER BY c.embedding <=> CAST(:qvec AS vector)
    LIMIT :n
    """
)

KEYWORD_SQL = text(
    """
    SELECT c.id, ts_rank_cd(c.tsv, q) AS rank
    FROM chunks c JOIN documents d ON d.id = c.document_id,
         websearch_to_tsquery('english', :q) q
    WHERE c.workspace_id = :ws AND d.status = 'ready' AND c.tsv @@ q
    ORDER BY rank DESC
    LIMIT :n
    """
)

FETCH_SQL = text(
    """
    SELECT c.id, c.document_id, d.filename, c.page, c.ordinal, c.content
    FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE c.id = ANY(:ids)
    """
)


async def hybrid_search(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    query: str,
    k: int = 6,
    candidates: int = 24,
    min_similarity: float = 0.0,
) -> list[RetrievedChunk]:
    query = query.strip()
    if not query:
        return []
    qvec = await get_embedder().embed_query(query)
    qvec_lit = "[" + ",".join(f"{x:.6f}" for x in qvec) + "]"

    vec_rows = (await session.execute(VECTOR_SQL, {"qvec": qvec_lit, "ws": workspace_id, "n": candidates})).all()
    kw_rows = (await session.execute(KEYWORD_SQL, {"q": query, "ws": workspace_id, "n": candidates})).all()

    scores: dict[uuid.UUID, float] = {}
    vrank: dict[uuid.UUID, int] = {}
    krank: dict[uuid.UUID, int] = {}
    sim: dict[uuid.UUID, float] = {}
    for i, (cid, s) in enumerate(vec_rows, start=1):
        vrank[cid] = i
        sim[cid] = float(s)
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + i)
    for i, (cid, _) in enumerate(kw_rows, start=1):
        krank[cid] = i
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + i)

    ranked = [
        cid
        for cid in sorted(scores, key=scores.get, reverse=True)  # type: ignore[arg-type]
        if cid in krank or sim.get(cid, 1.0) >= min_similarity
    ][:k]
    if not ranked:
        return []
    rows = {r.id: r for r in (await session.execute(FETCH_SQL, {"ids": ranked})).all()}
    out = []
    for cid in ranked:
        r = rows.get(cid)
        if r is None:
            continue
        out.append(
            RetrievedChunk(
                chunk_id=str(cid),
                document_id=str(r.document_id),
                filename=r.filename,
                page=r.page,
                ordinal=r.ordinal,
                content=r.content,
                score=round(scores[cid], 5),
                similarity=round(sim[cid], 4) if cid in sim else None,
                vector_rank=vrank.get(cid),
                keyword_rank=krank.get(cid),
            )
        )
    return out


def format_context(chunks: list[RetrievedChunk]) -> str:
    """Numbered context block. Agents cite chunks as [n]; we map n back to chunk ids."""
    if not chunks:
        return "(The knowledge base returned nothing for this query.)"
    return "\n\n".join(f"[{i}] ({c.ref})\n{c.content}" for i, c in enumerate(chunks, start=1))
