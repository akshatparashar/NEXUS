"""Monitoring queries. Every number here is computed from stored rows; nothing is invented."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def overview(s: AsyncSession, ws: uuid.UUID, days: int = 14) -> dict[str, Any]:
    since = datetime.now(UTC) - timedelta(days=days)
    totals = (
        await s.execute(
            text(
                """
                SELECT
                  (SELECT count(*) FROM workflows WHERE workspace_id = :ws) AS workflows,
                  count(*) AS runs,
                  count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
                  count(*) FILTER (WHERE status IN ('failed','timed_out')) AS failed,
                  count(*) FILTER (WHERE status IN ('queued','running')) AS active,
                  count(*) FILTER (WHERE status = 'awaiting_approval') AS awaiting_approval,
                  count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE status = 'succeeded') AS p50_ms,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE status = 'succeeded') AS p95_ms,
                  coalesce(sum(tokens_in), 0) AS tokens_in,
                  coalesce(sum(tokens_out), 0) AS tokens_out
                FROM workflow_runs WHERE workspace_id = :ws
                """
            ),
            {"ws": ws},
        )
    ).mappings().one()

    daily = (
        await s.execute(
            text(
                """
                SELECT d::date AS day,
                  count(r.id) FILTER (WHERE r.status = 'succeeded') AS succeeded,
                  count(r.id) FILTER (WHERE r.status IN ('failed','timed_out')) AS failed,
                  count(r.id) FILTER (WHERE r.status NOT IN ('succeeded','failed','timed_out')) AS other
                FROM generate_series(date_trunc('day', CAST(:since AS timestamptz)), date_trunc('day', now()), interval '1 day') d
                LEFT JOIN workflow_runs r ON r.workspace_id = :ws AND date_trunc('day', r.queued_at) = d
                GROUP BY d ORDER BY d
                """
            ),
            {"ws": ws, "since": since},
        )
    ).mappings().all()

    docs = (
        await s.execute(
            text(
                "SELECT count(*) AS documents, coalesce(sum(chunk_count),0) AS chunks, "
                "count(*) FILTER (WHERE status='ready') AS ready FROM documents WHERE workspace_id = :ws"
            ),
            {"ws": ws},
        )
    ).mappings().one()

    finished = (totals["succeeded"] or 0) + (totals["failed"] or 0)
    return {
        **{k: (float(v) if isinstance(v, float) else v) for k, v in totals.items()},
        "success_rate": (totals["succeeded"] / finished) if finished else None,
        "daily": [dict(r) for r in daily],
        "documents": dict(docs),
    }


async def agent_stats(s: AsyncSession, ws: uuid.UUID) -> list[dict[str, Any]]:
    rows = await s.execute(
        text(
            """
            SELECT st.agent_type,
              count(*) AS steps,
              count(*) FILTER (WHERE st.status = 'succeeded') AS succeeded,
              count(*) FILTER (WHERE st.status = 'failed') AS failed,
              count(*) FILTER (WHERE st.attempt > 1) AS retries,
              count(*) FILTER (WHERE st.iteration > 1) AS revisions,
              avg(st.duration_ms) FILTER (WHERE st.status = 'succeeded') AS avg_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY st.duration_ms) FILTER (WHERE st.status = 'succeeded') AS p95_ms,
              coalesce(sum(st.tokens_in + st.tokens_out), 0) AS tokens,
              max(st.started_at) AS last_active
            FROM run_steps st JOIN workflow_runs r ON r.id = st.run_id
            WHERE r.workspace_id = :ws
            GROUP BY st.agent_type
            """
        ),
        {"ws": ws},
    )
    return [{k: (float(v) if hasattr(v, "is_finite") else v) for k, v in dict(r).items()} for r in rows.mappings().all()]


async def recent_events(s: AsyncSession, ws: uuid.UUID, limit: int, type_prefix: str | None, run_id: uuid.UUID | None) -> list[dict[str, Any]]:
    q = """
        SELECT e.event_id, e.type, e.run_id, e.seq, e.topic, e.payload, e.occurred_at, e.processed_at,
               r.workflow_name
        FROM execution_events e LEFT JOIN workflow_runs r ON r.id = e.run_id
        WHERE e.workspace_id = :ws
    """
    params: dict[str, Any] = {"ws": ws, "limit": limit}
    if type_prefix:
        q += " AND e.type LIKE :tp"
        params["tp"] = type_prefix + "%"
    if run_id:
        q += " AND e.run_id = :run"
        params["run"] = run_id
    q += " ORDER BY e.id DESC LIMIT :limit"
    rows = (await s.execute(text(q), params)).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        p = dict(d["payload"] or {})
        for k in ("output", "tools"):
            p.pop(k, None)
        d["payload"] = p
        d["latency_ms"] = int((d["processed_at"] - d["occurred_at"]).total_seconds() * 1000)
        out.append(d)
    return out


async def pipeline(s: AsyncSession) -> dict[str, Any]:
    outbox = (
        await s.execute(
            text(
                """
                SELECT topic,
                  count(*) FILTER (WHERE published_at IS NOT NULL) AS published,
                  count(*) FILTER (WHERE published_at IS NULL) AS pending,
                  count(*) FILTER (WHERE published_at > now() - interval '5 minutes') AS last_5m,
                  avg(extract(epoch FROM (published_at - created_at)) * 1000) FILTER (WHERE published_at > now() - interval '1 hour') AS avg_relay_ms
                FROM outbox GROUP BY topic ORDER BY topic
                """
            )
        )
    ).mappings().all()
    consumers = (
        await s.execute(text("SELECT * FROM consumer_stats ORDER BY consumer, topic"))
    ).mappings().all()
    throughput = (
        await s.execute(
            text(
                """
                SELECT date_trunc('minute', created_at) AS minute, topic, count(*) AS n
                FROM outbox WHERE created_at > now() - interval '30 minutes'
                GROUP BY 1, 2 ORDER BY 1
                """
            )
        )
    ).mappings().all()
    return {
        "topics": [{k: (float(v) if hasattr(v, "is_finite") else v) for k, v in dict(r).items()} for r in outbox],
        "consumers": [dict(r) for r in consumers],
        "throughput": [dict(r) for r in throughput],
    }


async def dead_letters(s: AsyncSession, ws: uuid.UUID, limit: int = 50) -> list[dict[str, Any]]:
    rows = await s.execute(
        text(
            "SELECT id, consumer, topic, event_id, type, error, attempts, created_at, replayed_at "
            "FROM dead_letters WHERE envelope->>'workspace_id' = :ws ORDER BY created_at DESC LIMIT :n"
        ),
        {"n": limit, "ws": str(ws)},
    )
    return [dict(r) for r in rows.mappings().all()]
