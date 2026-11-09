"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { get } from "./api";
import { TERMINAL } from "./agents";
import { streamSSE } from "./sse";
import type { LifecycleEvent, Run, Step } from "./types";

export interface NodeLive {
  status: "idle" | "running" | "succeeded" | "failed" | "awaiting_approval" | "cancelled";
  step?: Step;
  attempts: number;
  iterations: number;
}

/**
 * Follow one run live. The persisted run (React Query) is the source of truth; the SSE stream
 * replays every lifecycle event after Last-Event-ID, then streams new ones and token deltas.
 */
export function useRun(runId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["run", runId],
    queryFn: () => get<Run>(`/runs/${runId}`),
    enabled: !!runId,
  });
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [streaming, setStreaming] = useState(false);
  const lastSeq = useRef(0);
  const status = query.data?.status;
  const terminal = status ? TERMINAL.includes(status) : false;
  const hasData = !!query.data;
  const phase = terminal ? "terminal" : "active";

  // a different run: start from empty (adjusting state during render, not in an effect)
  const [prevRunId, setPrevRunId] = useState(runId);
  if (runId !== prevRunId) {
    setPrevRunId(runId);
    setEvents([]);
    setTokens({});
  }
  useEffect(() => {
    lastSeq.current = 0;
  }, [runId]);

  useEffect(() => {
    if (!runId || !hasData) return;
    const ctrl = new AbortController();
    let stop = false;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        qc.invalidateQueries({ queryKey: ["run", runId] });
      }, 120);
    };

    (async () => {
      let backoff = 800;
      while (!stop) {
        let ended = false;
        setStreaming(true);
        try {
          await streamSSE(`/runs/${runId}/stream`, {
            signal: ctrl.signal,
            headers: lastSeq.current ? { "Last-Event-ID": String(lastSeq.current) } : {},
            onMessage: (m) => {
              if (m.event === "token") {
                const t = JSON.parse(m.data) as { step_id: string; text: string };
                setTokens((prev) => ({ ...prev, [t.step_id]: (prev[t.step_id] ?? "") + t.text }));
                return;
              }
              if (m.event === "end") {
                ended = true;
                refresh();
                return;
              }
              if (m.event !== "lifecycle") return;
              const ev = JSON.parse(m.data) as LifecycleEvent;
              if (ev.seq && ev.seq <= lastSeq.current) return;
              if (ev.seq) lastSeq.current = ev.seq;
              setEvents((prev) => [...prev, ev]);
              if (ev.type !== "tool.called") refresh();
            },
          });
        } catch {
          /* network drop: reconnect with Last-Event-ID */
        }
        setStreaming(false);
        if (ended || stop) break;
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 10000);
      }
    })();
    return () => {
      stop = true;
      ctrl.abort();
      if (pending) clearTimeout(pending);
    };
    // `phase` flips when a finished run is retried, which opens a fresh stream from lastSeq
  }, [runId, hasData, phase, qc]);

  const nodes = useMemo(() => {
    const out: Record<string, NodeLive> = {};
    const steps = query.data?.steps ?? [];
    for (const s of steps) {
      const cur = out[s.node_id] ?? { status: "idle", attempts: 0, iterations: 0 };
      cur.attempts += 1;
      cur.iterations = Math.max(cur.iterations, s.iteration);
      cur.step = s;
      cur.status = s.status as NodeLive["status"];
      out[s.node_id] = cur;
    }
    return out;
  }, [query.data?.steps]);

  return { ...query, run: query.data, events, tokens, nodes, streaming, terminal };
}
