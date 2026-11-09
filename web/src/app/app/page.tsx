"use client";

import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowUpRight, Check, Play } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AgentStack } from "@/components/agent-tile";
import { Columns } from "@/components/charts/charts";
import { RunTape } from "@/components/charts/run-tape";
import { RunDialog } from "@/components/run-dialog";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/pill";
import { Card, Empty, ErrorNote, PageHeader, Skeleton } from "@/components/ui/primitives";
import { useActivity } from "@/lib/activity";
import { get } from "@/lib/api";
import { fmtCompact, fmtDuration, fmtInt, fmtPct, fmtRelative } from "@/lib/format";
import type { Approval, LifecycleEvent, RunSummary, WorkflowSummary } from "@/lib/types";
import { useRun } from "@/lib/use-run";

interface Overview {
  workflows: number;
  runs: number;
  succeeded: number;
  failed: number;
  active: number;
  awaiting_approval: number;
  cancelled: number;
  p50_ms: number | null;
  p95_ms: number | null;
  tokens_in: number;
  tokens_out: number;
  success_rate: number | null;
  daily: { day: string; succeeded: number; failed: number; other: number }[];
  documents: { documents: number; chunks: number; ready: number };
}

export default function OverviewPage() {
  const [runOpen, setRunOpen] = useState(false);
  const ov = useQuery({ queryKey: ["overview"], queryFn: () => get<Overview>("/monitoring/overview?days=14"), refetchInterval: 15_000 });
  const runs = useQuery({ queryKey: ["runs", "recent"], queryFn: () => get<RunSummary[]>("/runs?limit=6") });
  const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => get<Approval[]>("/approvals") });
  const workflows = useQuery({ queryKey: ["workflows"], queryFn: () => get<WorkflowSummary[]>("/workflows") });

  const o = ov.data;
  const latest = runs.data?.find((r) => r.status === "running" || r.status === "awaiting_approval") ?? runs.data?.[0];
  const pending = approvals.data ?? [];
  const firstRun = o && o.runs === 0;

  const finding = useMemo(() => {
    if (!o) return null;
    if (pending.length) return `${pending.length} ${pending.length === 1 ? "run is" : "runs are"} waiting for your approval.`;
    if (o.active) return `${o.active} ${o.active === 1 ? "run is" : "runs are"} working right now.`;
    if (o.runs === 0) return "No runs yet. Add a document, then run a template workflow.";
    const recentFailed = o.daily.slice(-1)[0]?.failed ?? 0;
    if (recentFailed) return `${recentFailed} ${recentFailed === 1 ? "run" : "runs"} failed today. Open them to retry from the last checkpoint.`;
    return `All clear: ${fmtInt(o.succeeded)} of ${fmtInt(o.runs)} runs succeeded in the last 14 days.`;
  }, [o, pending.length]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Overview"
        sub={finding ?? <Skeleton className="mt-1 h-4 w-80" />}
        actions={
          <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => setRunOpen(true)}>
            New run
          </Button>
        }
      />

      {firstRun && <GettingStarted documents={o.documents.ready} onRun={() => setRunOpen(true)} />}

      {/* KPI strip: one container split by hairlines */}
      <section aria-label="Key figures" className="mb-6 grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--card-shadow)] sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Runs · 14 days" value={o ? fmtInt(o.runs) : null} sub={o ? `${fmtInt(o.active)} active` : null} />
        <Kpi
          label="Success rate"
          value={o ? fmtPct(o.success_rate) : null}
          sub={o ? (o.failed ? <span className="text-[var(--pill-negative-ink)]">{fmtInt(o.failed)} failed</span> : "0 failed") : null}
        />
        <Kpi label="Median duration" value={o ? fmtDuration(o.p50_ms) : null} sub="succeeded runs" />
        <Kpi label="p95 duration" value={o ? fmtDuration(o.p95_ms) : null} sub="succeeded runs" />
        <Kpi label="Tokens used" value={o ? fmtCompact(o.tokens_in + o.tokens_out) : null} sub={o ? `${fmtCompact(o.tokens_in)} in · ${fmtCompact(o.tokens_out)} out` : null} />
        <Kpi label="Knowledge" value={o ? fmtInt(o.documents.ready) : null} sub={o ? `${fmtInt(o.documents.chunks)} chunks indexed` : null} />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <LatestRun runId={latest?.id} loading={runs.isLoading} onRun={() => setRunOpen(true)} />
        <NeedsYou approvals={pending} loading={approvals.isLoading} runs={runs.data ?? []} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Runs per day" sub="Last 14 days, by outcome" action={<Legend />}>
          {ov.error ? (
            <ErrorNote error={ov.error} onRetry={() => ov.refetch()} />
          ) : o ? (
            <Columns
              ariaLabel="Runs per day over the last 14 days"
              labels={o.daily.map((d) => new Date(d.day).toLocaleDateString("en-GB", { day: "numeric", month: "short" }))}
              series={{ succeeded: o.daily.map((d) => d.succeeded), failed: o.daily.map((d) => d.failed), other: o.daily.map((d) => d.other) }}
              segments={[
                { key: "succeeded", label: "Succeeded", color: "var(--accent)" },
                { key: "failed", label: "Failed", color: "var(--negative)" },
                { key: "other", label: "Other", color: "#55555c" },
              ]}
              height={200}
            />
          ) : (
            <Skeleton className="h-[200px] w-full" />
          )}
        </Card>
        <ActivityFeed />
      </div>

      <WorkflowTable workflows={workflows.data} loading={workflows.isLoading} error={workflows.error} />
      <RunDialog open={runOpen} onClose={() => setRunOpen(false)} />
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | null; sub?: React.ReactNode }) {
  return (
    <div className="border-b border-r border-rule px-5 py-4 last:border-r-0 xl:border-b-0">
      <p className="text-[12px] text-muted">{label}</p>
      {value == null ? <Skeleton className="mt-1.5 h-6 w-16" /> : <p className="num mt-1 text-[20px] leading-7 text-text">{value}</p>}
      {sub != null && <p className="mt-0.5 truncate text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="size-2 bg-accent" /> Succeeded
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 bg-negative" /> Failed
      </span>
    </div>
  );
}

function LatestRun({ runId, loading, onRun }: { runId?: string; loading: boolean; onRun: () => void }) {
  const { run, events } = useRun(runId);
  if (loading || (runId && !run)) {
    return (
      <Card title="Latest run">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-4 h-[140px] w-full" />
      </Card>
    );
  }
  if (!run) {
    return (
      <Card title="Latest run">
        <Empty
          title="No runs yet"
          body="Start a run and its steps appear here as a timeline: one lane per agent, live while it works."
          action={
            <Button size="sm" variant="primary" icon={<Play className="size-3" />} onClick={onRun}>
              Start a run
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {run.workflow_name} <StatusPill status={run.status} />
        </span>
      }
      sub={`Started ${fmtRelative(run.started_at ?? run.queued_at)} · ${fmtDuration(run.duration_ms ?? (run.started_at ? Date.now() - new Date(run.started_at).getTime() : null))} · ${fmtInt(run.tokens_in + run.tokens_out)} tokens`}
      action={
        <Link href={`/app/runs/${run.id}`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
          Open run <ArrowUpRight className="size-3.5" />
        </Link>
      }
    >
      <p className="mb-4 line-clamp-2 text-[13px] leading-5 text-muted">
        <span className="text-text">Task.</span> {run.input.task}
      </p>
      <RunTape graph={run.graph_snapshot} steps={run.steps} events={events} startedAt={run.started_at} finishedAt={run.finished_at} />
      {run.error && <p className="mt-3 text-[13px] text-[var(--pill-negative-ink)]">{run.error}</p>}
    </Card>
  );
}

function NeedsYou({ approvals, loading, runs }: { approvals: Approval[]; loading: boolean; runs: RunSummary[] }) {
  const failed = runs.filter((r) => r.status === "failed" || r.status === "timed_out").slice(0, 3);
  return (
    <Card title="Needs you" sub={approvals.length ? `${approvals.length} waiting for approval` : "Approvals and failures"}>
      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : approvals.length === 0 && failed.length === 0 ? (
        <div className="flex items-start gap-3 py-1">
          <span className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-[var(--pill-positive-bg)] text-[var(--pill-positive-ink)]">
            <Check className="size-3" />
          </span>
          <div>
            <p className="text-[13px] font-medium">Nothing is waiting for you</p>
            <p className="mt-0.5 text-[13px] leading-5 text-muted">Risky actions such as deleting a document pause the run here until you decide.</p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col">
          {approvals.slice(0, 4).map((a) => (
            <li key={a.id} className="flex items-center gap-3 border-t border-rule py-2.5 first:border-t-0 first:pt-0">
              <span className="size-1.5 flex-none rounded-full bg-warning" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">
                  {a.actions.map((x) => x.tool.replace("_", " ")).join(", ")}
                </p>
                <p className="truncate text-[12px] text-muted">
                  {a.actions[0]?.reason || "Waiting for a decision"} · {fmtRelative(a.created_at)}
                </p>
              </div>
              <Link href={`/app/runs/${a.run_id}`} className="flex-none rounded-full border border-control px-3 py-1 text-[12px] hover:border-[var(--control-hover)] hover:bg-raised">
                Review
              </Link>
            </li>
          ))}
          {failed.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-t border-rule py-2.5 first:border-t-0 first:pt-0">
              <span className="size-1.5 flex-none rounded-full bg-negative" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{r.workflow_name} failed</p>
                <p className="truncate text-[12px] text-muted">{r.error ?? "See the run for details"}</p>
              </div>
              <Link href={`/app/runs/${r.id}`} className="flex-none rounded-full border border-control px-3 py-1 text-[12px] hover:border-[var(--control-hover)] hover:bg-raised">
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const EVENT_TEXT: Record<string, (e: LifecycleEvent) => string> = {
  "workflow.started": (e) => `${e.payload.workflow_name ?? "Workflow"} started`,
  "workflow.completed": () => "Run completed",
  "workflow.failed": (e) => `Run failed: ${e.payload.error ?? ""}`,
  "workflow.cancelled": () => "Run cancelled",
  "workflow.resumed": (e) => `Run resumed (${e.payload.reason ?? ""})`,
  "agent.started": (e) => `${e.payload.label} started${e.payload.attempt > 1 ? ` · attempt ${e.payload.attempt}` : ""}`,
  "agent.completed": (e) => `${e.payload.label} finished`,
  "agent.failed": (e) => `${e.payload.label} failed${e.payload.will_retry ? ", retrying" : ""}`,
  "agent.retrying": (e) => `${e.payload.label} retrying in ${e.payload.delay_s}s`,
  "tool.called": (e) => `Tool ${e.payload.tool}${e.payload.error ? " failed" : ""}`,
  "review.revision_requested": (e) => `Reviewer sent work back to ${e.payload.target_label}`,
  "approval.required": () => "Approval needed",
  "approval.resolved": (e) => `Approval ${e.payload.status} by ${e.payload.decided_by}`,
  "document.status": (e) => `${e.payload.filename}: ${e.payload.status ?? `${e.payload.progress}%`}`,
};

function ActivityFeed() {
  const live = useActivity((s) => s.events);
  const recent = useQuery({ queryKey: ["events", "recent"], queryFn: () => get<(LifecycleEvent & { workflow_name?: string })[]>("/monitoring/events?limit=12") });
  const merged = useMemo(() => {
    const seen = new Set<string>();
    const all = [...live, ...(recent.data ?? [])].filter((e) => {
      if (seen.has(e.event_id)) return false;
      seen.add(e.event_id);
      return true;
    });
    return all
      .filter((e) => !(e.type === "document.status" && !e.payload.status))
      .sort((a, b) => +new Date(b.occurred_at) - +new Date(a.occurred_at))
      .slice(0, 8);
  }, [live, recent.data]);

  return (
    <Card title="Live activity" sub="Lifecycle events from the event pipeline">
      {recent.isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : merged.length === 0 ? (
        <p className="text-[13px] text-muted">Events appear here the moment agents start working.</p>
      ) : (
        <ul className="flex flex-col">
          {merged.map((e) => (
            <li key={e.event_id} className="rise flex items-baseline gap-3 py-1.5 text-[13px]">
              <span
                className={clsx(
                  "size-1.5 flex-none translate-y-[-1px] rounded-full",
                  e.type.endsWith("failed") ? "bg-negative" : e.type.startsWith("approval") ? "bg-warning" : e.type === "agent.started" ? "bg-thinking" : "bg-[#5a5a62]",
                )}
              />
              <span className="min-w-0 flex-1 truncate">
                {e.run_id ? (
                  <Link href={`/app/runs/${e.run_id}`} className="hover:text-accent-ink">
                    {(EVENT_TEXT[e.type] ?? ((x: LifecycleEvent) => x.type))(e)}
                  </Link>
                ) : (
                  (EVENT_TEXT[e.type] ?? ((x: LifecycleEvent) => x.type))(e)
                )}
              </span>
              <span className="num flex-none text-[12px] text-muted">{fmtRelative(e.occurred_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WorkflowTable({ workflows, loading, error }: { workflows?: WorkflowSummary[]; loading: boolean; error: unknown }) {
  const [runFor, setRunFor] = useState<string | null>(null);
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-[20px] font-normal text-muted">Workflows</h2>
        <Link href="/app/workflows" className="text-[13px] text-muted hover:text-text">
          View all
        </Link>
      </div>
      <div className="overflow-x-auto rounded-[var(--radius-card)] bg-surface shadow-[var(--card-shadow)]">
        {error ? (
          <div className="p-5">
            <ErrorNote error={error} />
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="h-10 px-5 font-normal">Name</th>
                <th className="font-normal">Agents</th>
                <th className="text-right font-normal">Runs</th>
                <th className="pl-8 font-normal">Last run</th>
                <th className="w-[1%] px-5" />
              </tr>
            </thead>
            <tbody>
              {loading &&
                [0, 1, 2].map((i) => (
                  <tr key={i} className="border-t border-rule">
                    <td className="h-[var(--row)] px-5" colSpan={5}>
                      <Skeleton className="h-4 w-1/3" />
                    </td>
                  </tr>
                ))}
              {workflows?.slice(0, 5).map((w) => (
                <tr key={w.id} className="group border-t border-rule transition-colors hover:bg-white/[0.02]">
                  <td className="h-[var(--row)] px-5">
                    <Link href={`/app/workflows/${w.id}`} className="font-medium hover:text-accent-ink">
                      {w.name}
                    </Link>
                  </td>
                  <td>
                    <AgentStack types={w.agent_types} size={20} />
                  </td>
                  <td className="num text-right">{fmtInt(w.run_count)}</td>
                  <td className="pl-8">
                    {w.last_run_status ? (
                      <span className="flex items-center gap-2">
                        <StatusPill status={w.last_run_status} />
                        <span className="text-[12px] text-muted">{fmtRelative(w.last_run_at)}</span>
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-5 text-right">
                    <Button size="sm" variant="secondary" icon={<Play className="size-3" />} onClick={() => setRunFor(w.id)}>
                      Run
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <RunDialog open={!!runFor} onClose={() => setRunFor(null)} workflowId={runFor ?? undefined} />
    </section>
  );
}

function GettingStarted({ documents, onRun }: { documents: number; onRun: () => void }) {
  const steps = [
    { done: true, title: "Workspace ready", body: "Three template workflows are waiting for you." },
    { done: documents > 0, title: "Add a document", body: "PDF, TXT or Markdown. Agents cite it in their answers.", href: "/app/knowledge?upload=1", cta: "Upload" },
    { done: false, title: "Run a workflow", body: "Watch Research, Analyst and Reviewer work live.", onClick: onRun, cta: "Start a run" },
  ];
  const pct = steps.filter((s) => s.done).length / steps.length;
  return (
    <section aria-label="Getting started" className="mb-6 rounded-[var(--radius-card)] bg-surface p-5 shadow-[var(--card-shadow)]">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-[14px] font-semibold">Get your first run going</h2>
        <span className="num text-[12px] text-muted">{Math.round(pct * 100)}% done</span>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-3">
            <span
              className={clsx(
                "mt-0.5 flex size-5 flex-none items-center justify-center rounded-full border text-[11px]",
                s.done ? "border-transparent bg-[var(--pill-positive-bg)] text-[var(--pill-positive-ink)]" : "border-control text-muted",
              )}
            >
              {s.done ? <Check className="size-3" /> : null}
            </span>
            <div className="min-w-0">
              <p className={clsx("text-[13px] font-medium", s.done && "text-muted line-through decoration-[#55555c]")}>{s.title}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-muted">{s.body}</p>
              {!s.done && s.cta && (
                <div className="mt-2">
                  {s.href ? (
                    <Link href={s.href} className="inline-flex h-7 items-center rounded-full border border-control px-3 text-[12px] hover:bg-raised">
                      {s.cta}
                    </Link>
                  ) : (
                    <Button size="sm" variant="primary" onClick={s.onClick}>
                      {s.cta}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
