"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AgentTile } from "@/components/agent-tile";
import { Columns } from "@/components/charts/charts";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Card, ErrorNote, PageHeader, Segmented, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useActivity } from "@/lib/activity";
import { AGENTS } from "@/lib/agents";
import { get, post } from "@/lib/api";
import { fmtClock, fmtDuration, fmtInt, fmtPct, fmtRelative } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { AgentType, ConfigStatus, JsonObject } from "@/lib/types";

interface TopicRow {
  topic: string;
  published: number;
  pending: number;
  last_5m: number;
  avg_relay_ms: number | null;
}
interface ConsumerRow {
  consumer: string;
  topic: string;
  processed: number;
  failed: number;
  lag: number;
  last_event_at: string | null;
  updated_at: string;
}
interface DeadLetterRow {
  id: string;
  consumer: string;
  topic: string;
  event_id: string;
  type: string;
  error: string;
  attempts: number;
  created_at: string;
  replayed_at: string | null;
}
interface Pipeline {
  topics: TopicRow[];
  consumers: ConsumerRow[];
  throughput: { minute: string; topic: string; n: number }[];
  dead_letters: DeadLetterRow[];
}
interface AgentStat {
  agent_type: AgentType;
  steps: number;
  succeeded: number;
  failed: number;
  retries: number;
  revisions: number;
  avg_ms: number | null;
  p95_ms: number | null;
  tokens: number;
  last_active: string | null;
}
interface EventRow {
  event_id: string;
  type: string;
  run_id: string | null;
  seq: number | null;
  topic: string;
  payload: JsonObject;
  occurred_at: string;
  processed_at: string;
  latency_ms: number;
  workflow_name: string | null;
}

export default function MonitoringPage() {
  const pipe = useQuery({ queryKey: ["pipeline"], queryFn: () => get<Pipeline>("/monitoring/pipeline"), refetchInterval: 5_000 });
  const agents = useQuery({ queryKey: ["agents-stats"], queryFn: () => get<AgentStat[]>("/monitoring/agents"), refetchInterval: 15_000 });
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<ConfigStatus>("/health/config"), refetchInterval: 30_000 });
  const p = pipe.data;

  const topic = (name: string) => p?.topics.find((t) => t.topic === name);
  const consumer = (name: string) => p?.consumers.filter((c) => c.consumer === name) ?? [];
  const pendingTotal = p?.topics.reduce((a, t) => a + t.pending, 0) ?? 0;
  const lagTotal = p?.consumers.reduce((a, c) => a + c.lag, 0) ?? 0;
  const dlqOpen = p?.dead_letters.filter((d) => !d.replayed_at).length ?? 0;

  const finding = !p
    ? null
    : dlqOpen
      ? `${dlqOpen} ${dlqOpen === 1 ? "event" : "events"} in the dead-letter queue need attention.`
      : pendingTotal > 20 || lagTotal > 20
        ? `Backlog building: ${fmtInt(pendingTotal)} unpublished in the outbox, consumer lag ${fmtInt(lagTotal)}.`
        : `Pipeline healthy: outbox drained, consumers caught up, no dead letters.`;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Monitoring"
        sub={finding ?? <Skeleton className="mt-1 h-4 w-72" />}
        actions={
          cfg.data && (
            <span className="num text-[12px] text-muted">
              bus {cfg.data.event_bus.kind} · realtime {cfg.data.realtime.kind} · db {cfg.data.database.latency_ms ?? "—"} ms
            </span>
          )
        }
      />

      {pipe.error ? <ErrorNote error={pipe.error} onRetry={() => pipe.refetch()} /> : null}

      {/* the event pipeline, as it actually runs */}
      <Card title="Event pipeline" sub="Transactional outbox → Kafka topics → consumer groups → read models and live SSE" className="mb-6">
        {!p ? (
          <Skeleton className="h-[132px] w-full" />
        ) : (
          <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr]">
            <Stage title="API + outbox" lines={[["Unpublished", fmtInt(pendingTotal), pendingTotal > 0], ["Avg relay", topic("nexus.lifecycle")?.avg_relay_ms != null ? `${Math.round(topic("nexus.lifecycle")!.avg_relay_ms!)} ms` : "—", false]]} />
            <Arrow />
            <Stage
              title="nexus.commands"
              mono
              lines={[
                ["Published", fmtInt(topic("nexus.commands")?.published ?? 0), false],
                ["Last 5 min", fmtInt(topic("nexus.commands")?.last_5m ?? 0), false],
              ]}
            />
            <Arrow />
            <Stage
              title="nexus-worker"
              mono
              lines={[
                ["Processed", fmtInt(consumer("nexus-worker").reduce((a, c) => a + c.processed, 0)), false],
                ["Lag", fmtInt(consumer("nexus-worker").reduce((a, c) => a + c.lag, 0)), consumer("nexus-worker").some((c) => c.lag > 0)],
              ]}
              live={consumer("nexus-worker")[0]?.updated_at}
            />
            <Arrow />
            <Stage
              title="nexus.lifecycle"
              mono
              lines={[
                ["Published", fmtInt(topic("nexus.lifecycle")?.published ?? 0), false],
                ["Last 5 min", fmtInt(topic("nexus.lifecycle")?.last_5m ?? 0), false],
              ]}
            />
            <Arrow />
            <Stage
              title="nexus-projector"
              mono
              lines={[
                ["Processed", fmtInt(consumer("nexus-projector").reduce((a, c) => a + c.processed, 0)), false],
                ["Failed", fmtInt(consumer("nexus-projector").reduce((a, c) => a + c.failed, 0)), consumer("nexus-projector").some((c) => c.failed > 0)],
              ]}
              live={consumer("nexus-projector")[0]?.updated_at}
            />
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Agent performance" sub="All runs in this workspace">
          {agents.error ? (
            <ErrorNote error={agents.error} onRetry={() => agents.refetch()} />
          ) : !agents.data ? (
            <Skeleton className="h-[180px] w-full" />
          ) : agents.data.length === 0 ? (
            <p className="text-[13px] text-muted">Agent statistics appear after the first run.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="h-9 font-normal">Agent</th>
                    <th className="text-right font-normal">Steps</th>
                    <th className="text-right font-normal">Success</th>
                    <th className="text-right font-normal">Retries</th>
                    <th className="text-right font-normal">Revisions</th>
                    <th className="text-right font-normal">Avg</th>
                    <th className="text-right font-normal">p95</th>
                    <th className="text-right font-normal">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {["research", "analyst", "execution", "reviewer"].map((t) => {
                    const a = agents.data.find((x) => x.agent_type === t);
                    return (
                      <tr key={t} className="border-t border-rule">
                        <td className="h-[var(--row)]">
                          <span className="flex items-center gap-2.5">
                            <AgentTile type={t as AgentType} size={22} />
                            {AGENTS[t as AgentType].label}
                          </span>
                        </td>
                        <td className="num text-right">{a ? fmtInt(a.steps) : "0"}</td>
                        <td className={clsx("num text-right", a && a.failed > 0 && "text-[var(--pill-negative-ink)]")}>{a && a.succeeded + a.failed ? fmtPct(a.succeeded / (a.succeeded + a.failed)) : "—"}</td>
                        <td className="num text-right">{a ? fmtInt(a.retries) : "0"}</td>
                        <td className="num text-right">{a ? fmtInt(a.revisions) : "0"}</td>
                        <td className="num text-right">{fmtDuration(a?.avg_ms)}</td>
                        <td className="num text-right">{fmtDuration(a?.p95_ms)}</td>
                        <td className="num text-right">{a ? fmtInt(a.tokens) : "0"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Throughput" sub="Events written to the outbox per minute, last 30 minutes">
          {!p ? <Skeleton className="h-[180px] w-full" /> : <Throughput rows={p.throughput} />}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <EventStream />
        <div className="flex min-w-0 flex-col gap-6">
          <DeadLetters rows={p?.dead_letters} />
          <ErrorLog />
        </div>
      </div>
    </div>
  );
}

function Stage({ title, lines, mono, live }: { title: string; lines: [string, string, boolean][]; mono?: boolean; live?: string }) {
  const now = useNow(!!live, 2000);
  const fresh = live && now - new Date(live).getTime() < 10_000;
  return (
    <div className="flex flex-col rounded-[8px] bg-raised/60 p-3.5">
      <p className={clsx("flex items-center gap-2 text-[13px] font-medium", mono && "num")}>
        {live !== undefined && <span className={clsx("size-1.5 rounded-full", fresh ? "bg-positive" : "bg-[#5a5a62]")} title={fresh ? "Consumer active" : "No recent heartbeat"} />}
        {title}
      </p>
      <dl className="mt-2">
        {lines.map(([k, v, warn]) => (
          <div key={k} className="flex h-6 items-center justify-between text-[12px]">
            <dt className="text-muted">{k}</dt>
            <dd className={clsx("num", warn ? "text-[var(--pill-warning-ink)]" : "text-text")}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Arrow() {
  return (
    <div className="hidden items-center justify-center text-[#55555c] lg:flex" aria-hidden>
      <ArrowRight className="size-4" />
    </div>
  );
}

function Throughput({ rows }: { rows: Pipeline["throughput"] }) {
  const { labels, commands, lifecycle } = useMemo(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    const mins = [...Array(30).keys()].map((i) => new Date(now.getTime() - (29 - i) * 60_000));
    const key = (d: Date) => d.toISOString().slice(0, 16);
    const by = new Map(rows.map((r) => [`${new Date(r.minute).toISOString().slice(0, 16)}|${r.topic}`, r.n]));
    return {
      labels: mins.map((d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })),
      commands: mins.map((d) => by.get(`${key(d)}|nexus.commands`) ?? 0),
      lifecycle: mins.map((d) => by.get(`${key(d)}|nexus.lifecycle`) ?? 0),
    };
  }, [rows]);
  return (
    <>
      <div className="mb-3 flex items-center gap-3 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2 bg-accent" /> lifecycle
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 bg-[#9fa3ab]" /> commands
        </span>
      </div>
      <Columns
        ariaLabel="Events per minute over the last 30 minutes"
        labels={labels}
        series={{ lifecycle, commands }}
        segments={[
          { key: "lifecycle", label: "nexus.lifecycle", color: "var(--accent)" },
          { key: "commands", label: "nexus.commands", color: "#9fa3ab" },
        ]}
        height={180}
      />
    </>
  );
}

const PREFIXES = { all: "", workflow: "workflow.", agent: "agent.", tool: "tool.", approval: "approval.", document: "document." } as const;

function EventStream() {
  const [filter, setFilter] = useState<keyof typeof PREFIXES>("all");
  const live = useActivity((s) => s.events.length);
  const q = useQuery({
    queryKey: ["events", "stream", filter, live],
    queryFn: () => get<EventRow[]>(`/monitoring/events?limit=40${PREFIXES[filter] ? `&type=${PREFIXES[filter]}` : ""}`),
    placeholderData: (prev) => prev,
  });
  return (
    <Card
      title="Event stream"
      sub="Persisted by the projector · latency is event time to processing time"
      action={
        <Segmented
          size="sm"
          label="Event type"
          value={filter}
          onChange={setFilter}
          items={(Object.keys(PREFIXES) as (keyof typeof PREFIXES)[]).map((k) => ({ value: k, label: k === "all" ? "All" : k }))}
        />
      }
    >
      {q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-[320px] w-full" />
      ) : q.data.length === 0 ? (
        <p className="text-[13px] text-muted">No events of this kind yet.</p>
      ) : (
        <div className="max-h-[440px] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-[12px] text-muted">
                <th className="h-8 w-20 font-normal">Time</th>
                <th className="font-normal">Type</th>
                <th className="font-normal">Run</th>
                <th className="w-16 text-right font-normal">Seq</th>
                <th className="w-20 text-right font-normal">Latency</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((e) => (
                <tr key={e.event_id} className="border-t border-rule">
                  <td className="num h-9 text-muted">{fmtClock(e.occurred_at)}</td>
                  <td className="num truncate pr-3">
                    <span className={clsx(e.type.endsWith("failed") && "text-[var(--pill-negative-ink)]", e.type.startsWith("approval") && "text-[var(--pill-warning-ink)]")}>{e.type}</span>
                    {e.payload.label && <span className="text-muted"> · {e.payload.label}</span>}
                    {e.payload.filename && <span className="text-muted"> · {e.payload.filename}</span>}
                  </td>
                  <td className="truncate pr-3">
                    {e.run_id ? (
                      <Link href={`/app/runs/${e.run_id}`} className="text-muted hover:text-text">
                        {e.workflow_name ?? e.run_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="num text-right text-muted">{e.seq ?? "—"}</td>
                  <td className="num text-right">{fmtInt(e.latency_ms)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DeadLetters({ rows }: { rows?: DeadLetterRow[] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card title="Dead-letter queue" sub="Events a consumer could not process after 3 attempts">
      {!rows ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <span className="size-1.5 rounded-full bg-positive" /> Empty. Every event was processed.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.slice(0, 6).map((d) => (
            <li key={d.id} className="flex items-start gap-3 border-t border-rule py-2.5 first:border-t-0 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="num truncate text-[13px]">{d.type}</p>
                <p className="truncate text-[12px] text-muted">
                  {d.consumer} · {d.error}
                </p>
              </div>
              {d.replayed_at ? (
                <Pill tone="neutral">Replayed</Pill>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw className="size-3" />}
                  loading={busy === d.id}
                  onClick={async () => {
                    setBusy(d.id);
                    try {
                      await post(`/monitoring/dead-letters/${d.id}/replay`);
                      qc.invalidateQueries({ queryKey: ["pipeline"] });
                      toast.success("Event re-published", "It goes back through the outbox to its topic.");
                    } catch (e) {
                      toast.error("Couldn't replay", (e as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Replay
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ErrorLog() {
  const live = useActivity((s) => s.events.filter((e) => e.type.endsWith("failed")).length);
  const q = useQuery({
    queryKey: ["events", "errors", live],
    queryFn: async () => {
      const [wf, ag] = await Promise.all([get<EventRow[]>("/monitoring/events?limit=10&type=workflow.failed"), get<EventRow[]>("/monitoring/events?limit=10&type=agent.failed")]);
      return [...wf, ...ag].sort((a, b) => +new Date(b.occurred_at) - +new Date(a.occurred_at)).slice(0, 8);
    },
    placeholderData: (prev) => prev,
  });
  return (
    <Card title="Errors and retries" sub="Failed attempts and failed runs">
      {!q.data ? (
        <Skeleton className="h-16 w-full" />
      ) : q.data.length === 0 ? (
        <p className="text-[13px] text-muted">No failures recorded.</p>
      ) : (
        <ul className="flex flex-col">
          {q.data.map((e) => (
            <li key={e.event_id} className="border-t border-rule py-2.5 first:border-t-0 first:pt-0">
              <p className="flex items-center gap-2 text-[13px]">
                <span className={clsx("size-1.5 rounded-full", e.payload.will_retry ? "bg-warning" : "bg-negative")} />
                <span className="min-w-0 flex-1 truncate">
                  {e.type === "workflow.failed" ? `${e.workflow_name ?? "Run"} failed` : `${e.payload.label} · attempt ${e.payload.attempt}`}
                </span>
                {e.payload.will_retry && <Pill tone="warning">retried</Pill>}
                <span className="num text-[12px] text-muted">{fmtRelative(e.occurred_at)}</span>
              </p>
              <p className="mt-0.5 line-clamp-2 pl-3.5 text-[12px] text-muted">{e.payload.error}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
