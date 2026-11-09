"use client";

import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ChevronDown, Download, FileText, Play, RotateCcw, ShieldAlert, Square, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AgentTile } from "@/components/agent-tile";
import { RunTape, TapeLegend } from "@/components/charts/run-tape";
import { ApprovalSheet } from "@/components/run/approval-sheet";
import { AgentMarkdown } from "@/components/run/markdown";
import { useCrumb } from "@/components/shell/top-bar";
import { Button } from "@/components/ui/button";
import { Pill, StatusPill, StepStatusPill } from "@/components/ui/pill";
import { Card, ErrorNote, Skeleton, Tabs } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { fmtClock, fmtDateTime, fmtDuration, fmtInt, plain, shortId } from "@/lib/format";
import type { LifecycleEvent, Run, RunSummary, Source, Step, ToolCall } from "@/lib/types";
import { useNow } from "@/lib/hooks";
import { useRun } from "@/lib/use-run";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const { run, events, tokens, error, refetch, isLoading } = useRun(id);
  const setCrumb = useCrumb((s) => s.set);
  useEffect(() => {
    setCrumb(run ? `${run.workflow_name} · ${shortId(run.id)}` : null);
    return () => setCrumb(null);
  }, [run, setCrumb]);

  if (error) return <div className="p-8"><ErrorNote error={error} onRetry={() => refetch()} /></div>;
  if (isLoading || !run) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="mt-3 h-4 w-[520px] max-w-full" />
        <Skeleton className="mt-8 h-[220px] w-full" />
      </div>
    );
  }
  return <RunView run={run} events={events} tokens={tokens} />;
}

function RunView({ run, events, tokens }: { run: Run; events: LifecycleEvent[]; tokens: Record<string, string> }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [tab, setTab] = useState<"steps" | "events">("steps");
  const [busy, setBusy] = useState<string | null>(null);
  const pendingApproval = run.approvals.find((a) => a.status === "pending");
  const active = ["queued", "running", "awaiting_approval"].includes(run.status);
  const now = useNow(active);
  const sources: Source[] = run.output?.sources ?? collectSources(run.steps);

  // a new approval request opens the sheet once
  const [seenApproval, setSeenApproval] = useState<string | undefined>(undefined);
  if (pendingApproval?.id !== seenApproval) {
    setSeenApproval(pendingApproval?.id);
    if (pendingApproval) setApprovalOpen(true);
  }

  const act = async (kind: "cancel" | "retry" | "rerun") => {
    setBusy(kind);
    try {
      if (kind === "rerun") {
        const r = await post<RunSummary>(`/workflows/${run.workflow_id}/runs`, { task: run.input.task });
        router.push(`/app/runs/${r.id}`);
        return;
      }
      await post(`/runs/${run.id}/${kind}`);
      qc.invalidateQueries({ queryKey: ["run", run.id] });
      toast.success(kind === "cancel" ? "Cancelling the run" : "Retrying from the last checkpoint");
    } catch (e) {
      toast.error(kind === "cancel" ? "Couldn't cancel" : "Couldn't start", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const elapsed = run.duration_ms ?? (run.started_at ? now - +new Date(run.started_at) : null);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
      {/* title row */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.015em]">{run.workflow_name}</h1>
            <StatusPill status={run.status} />
          </div>
          <p className="mt-2 max-w-[90ch] text-[14px] leading-[22px] text-text">{run.input.task}</p>
          <p className="num mt-1.5 text-[12px] text-muted">
            run {shortId(run.id)} · v{run.workflow_version} · started {fmtDateTime(run.started_at ?? run.queued_at)} · {fmtDuration(elapsed)} ·{" "}
            {fmtInt(run.tokens_in + run.tokens_out)} tokens
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/app/workflows/${run.workflow_id}`} className="inline-flex h-[34px] items-center gap-1.5 rounded-full px-3 text-[13px] text-muted hover:bg-raised hover:text-text">
            <WorkflowIcon className="size-3.5" /> Workflow
          </Link>
          {active && (
            <Button variant="secondary" icon={<Square className="size-3" />} onClick={() => act("cancel")} loading={busy === "cancel"}>
              Cancel
            </Button>
          )}
          {(run.status === "failed" || run.status === "timed_out") && (
            <Button variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={() => act("retry")} loading={busy === "retry"}>
              Retry from checkpoint
            </Button>
          )}
          {!active && (
            <Button variant={run.status === "failed" ? "secondary" : "primary"} icon={<Play className="size-3.5" />} onClick={() => act("rerun")} loading={busy === "rerun"}>
              Run again
            </Button>
          )}
        </div>
      </div>

      {pendingApproval && (
        <button
          onClick={() => setApprovalOpen(true)}
          className="mb-6 flex w-full items-center gap-3 rounded-[var(--radius-card)] bg-[var(--pill-warning-bg)] px-4 py-3 text-left transition-colors hover:bg-[#30291a]"
        >
          <ShieldAlert className="size-4 flex-none text-warning" />
          <span className="flex-1 text-[13px] text-[var(--pill-warning-ink)]">
            The Execution agent wants to {pendingApproval.actions.map(describeAction).join(" and ")}. The run is paused until you decide.
          </span>
          <span className="rounded-full bg-[#f2f2f3] px-3 py-1 text-[12px] font-medium text-[#111114]">Review</span>
        </button>
      )}

      {run.error && (
        <div className="mb-6 rounded-[var(--radius-card)] bg-[var(--pill-negative-bg)] px-4 py-3 text-[13px] text-[var(--pill-negative-ink)]" role="alert">
          {run.error}
        </div>
      )}

      <Card title="Timeline" sub={`${run.steps.length} ${run.steps.length === 1 ? "step" : "steps"} across ${run.graph_snapshot.nodes.length} agents`} action={<TapeLegend />}>
        <RunTape
          graph={run.graph_snapshot}
          steps={run.steps}
          events={events}
          startedAt={run.started_at}
          finishedAt={run.finished_at}
          selectedStep={selectedStep}
          onSelectStep={(sid) => {
            setSelectedStep(sid);
            setTab("steps");
            document.getElementById(`step-${sid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: "steps", label: "Steps", count: run.steps.length },
              { value: "events", label: "Event log", count: events.length },
            ]}
            className="mb-4"
          />
          {tab === "steps" ? (
            <StepList steps={run.steps} tokens={tokens} selected={selectedStep} onSelect={setSelectedStep} sources={sources} status={run.status} />
          ) : (
            <EventLog events={events} />
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          <ResultCard run={run} sources={sources} />
          <SourcesCard sources={sources} cited={citedSet(run)} />
          {run.artifacts.length > 0 && <ArtifactsCard run={run} />}
          {run.approvals.length > 0 && (
            <Card title="Approvals">
              <ul className="flex flex-col">
                {run.approvals.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 border-t border-rule py-2 text-[13px] first:border-t-0 first:pt-0">
                    <span className="min-w-0 flex-1 truncate">{a.actions.map((x) => x.tool).join(", ")}</span>
                    <Pill tone={a.status === "approved" ? "positive" : a.status === "rejected" ? "negative" : "warning"}>{a.status}</Pill>
                    {a.decision?.by && <span className="text-[12px] text-muted">{a.decision.by}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
      {pendingApproval && <ApprovalSheet key={pendingApproval.id} approval={pendingApproval} open={approvalOpen} onClose={() => setApprovalOpen(false)} />}
    </div>
  );
}

function describeAction(a: { tool: string; args: Record<string, unknown> }): string {
  if (a.tool === "delete_document") return `delete ${String(a.args.filename ?? "a document")}`;
  if (a.tool === "send_webhook") return `post a message to ${String(a.args.url ?? "a webhook")}`;
  return a.tool.replace(/_/g, " ");
}

function collectSources(steps: Step[]): Source[] {
  const seen = new Map<string, Source>();
  for (const s of steps) for (const src of (s.output?.sources as Source[]) ?? []) if (!seen.has(src.chunk_id)) seen.set(src.chunk_id, src);
  return [...seen.values()];
}

function citedSet(run: Run): Set<number> {
  const out = new Set<number>();
  for (const s of run.steps) for (const n of (s.output?.cited as number[]) ?? []) out.add(n);
  return out;
}

function StepList({
  steps,
  tokens,
  selected,
  onSelect,
  sources,
  status,
}: {
  steps: Step[];
  tokens: Record<string, string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  sources: Source[];
  status: string;
}) {
  if (steps.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] bg-surface p-5 text-[13px] text-muted shadow-[var(--card-shadow)]">
        {status === "queued" ? (
          <span className="flex items-center gap-2">
            <span className="thinking-dot" /> Waiting for a worker to pick up the run…
          </span>
        ) : (
          "No steps were recorded for this run."
        )}
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s) => (
        <StepItem key={s.id} step={s} stream={tokens[s.id]} open={selected === s.id || s.status === "running"} onToggle={() => onSelect(selected === s.id ? null : s.id)} sources={sources} />
      ))}
    </ol>
  );
}

function StepItem({ step, stream, open, onToggle, sources }: { step: Step; stream?: string; open: boolean; onToggle: () => void; sources: Source[] }) {
  const o = step.output ?? {};
  const running = step.status === "running";
  return (
    <li id={`step-${step.id}`} className={clsx("scroll-mt-24 rounded-[var(--radius-card)] bg-surface shadow-[var(--card-shadow)]", open && "ring-1 ring-inset ring-white/[0.04]")}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <AgentTile type={step.agent_type} size={26} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
            {step.label}
            {step.iteration > 1 && <Pill tone="neutral">revision {step.iteration - 1}</Pill>}
            {step.attempt > 1 && <Pill tone="neutral">attempt {step.attempt}</Pill>}
          </p>
          <p className="truncate text-[12px] text-muted">{step.input_summary}</p>
        </div>
        <StepStatusPill status={step.status} />
        <span className="num hidden w-[72px] text-right text-[12px] text-muted sm:block">{running ? "…" : fmtDuration(step.duration_ms)}</span>
        <ChevronDown className={clsx("size-4 flex-none text-muted transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-rule px-4 pb-4 pt-3">
          {running ? (
            <div>
              <p className="mb-2 flex items-center gap-2 text-[12px] text-[var(--pill-thinking-ink)]">
                <span className="thinking-dot" /> Generating
              </p>
              {stream ? <div className="caret whitespace-pre-wrap text-[14px] leading-[22px]">{stream}</div> : <p className="text-[13px] text-muted">Waiting for the first tokens…</p>}
              {step.tools.length > 0 && <ToolCalls tools={step.tools} />}
            </div>
          ) : step.status === "failed" ? (
            <p className="text-[13px] text-[var(--pill-negative-ink)]">{step.error}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {o.summary && <AgentMarkdown text={o.summary} sources={sources} />}
              {Array.isArray(o.findings) && o.findings.length > 0 && (
                <Section title="Findings">
                  <ul className="flex flex-col gap-1.5">
                    {o.findings.map((f: { claim: string; citations: number[] }, i: number) => (
                      <li key={i} className="text-[13px] leading-5">
                        {f.claim}{" "}
                        {f.citations.map((c) => (
                          <span key={c} className="num ml-0.5 rounded-[4px] bg-[var(--pill-accent-bg)] px-1 text-[11px] text-[var(--pill-accent-ink)]">
                            {c}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {Array.isArray(o.insights) && o.insights.length > 0 && (
                <Section title={`Insights · confidence ${Math.round((o.confidence ?? 0) * 100)}%`}>
                  <ul className="flex flex-col gap-2">
                    {o.insights.map((ins: { title: string; detail: string }, i: number) => (
                      <li key={i} className="text-[13px] leading-5">
                        <span className="font-medium">{ins.title}.</span> <span className="text-muted">{ins.detail}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {o.verdict && (
                <Section title="Verdict">
                  <p className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Pill tone={o.verdict === "approve" ? "positive" : "warning"}>{o.verdict === "approve" ? "Approved" : "Revision requested"}</Pill>
                    <span className="num text-muted">score {o.score}/10</span>
                    {o.verdict === "revise" && o.revise_target && <span className="text-muted">→ sent back to {o.revise_target}</span>}
                  </p>
                  {o.issues?.length > 0 && (
                    <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[13px] text-muted">
                      {o.issues.map((x: string, i: number) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  )}
                  {o.feedback && <p className="mt-2 text-[13px] leading-5"><span className="text-muted">Feedback:</span> {o.feedback}</p>}
                </Section>
              )}
              {Array.isArray(o.actions) && o.actions.length > 0 && (
                <Section title="Actions">
                  <ul className="flex flex-col gap-1.5">
                    {o.actions.map((a: { tool: string; status: string; reason: string; destructive: boolean }, i: number) => (
                      <li key={i} className="flex items-center gap-2 text-[13px]">
                        <Pill tone={a.status === "done" ? "positive" : a.status === "rejected" ? "neutral" : a.status === "failed" ? "negative" : "neutral"}>{a.status}</Pill>
                        <span className="num">{a.tool}</span>
                        <span className="truncate text-muted">{a.reason}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {(o.gaps?.length > 0 || o.open_questions?.length > 0) && (
                <Section title="Open questions">
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-muted">
                    {[...(o.gaps ?? []), ...(o.open_questions ?? [])].map((g: string, i: number) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </Section>
              )}
              {step.tools.length > 0 && <ToolCalls tools={step.tools} />}
              <p className="num text-[12px] text-muted">
                {fmtClock(step.started_at)} → {fmtClock(step.finished_at)} · {fmtInt(step.tokens_in)} in · {fmtInt(step.tokens_out)} out
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] text-muted">{title}</p>
      {children}
    </div>
  );
}

function ToolCalls({ tools }: { tools: ToolCall[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Section title="Tool calls">
      <ul className="flex flex-col gap-1">
        {tools.map((t, i) => (
          <li key={i}>
            <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px] hover:bg-raised">
              <span className={clsx("size-1.5 rounded-full", t.error || t.status === "failed" ? "bg-negative" : t.status === "rejected" ? "bg-[#5a5a62]" : "bg-accent")} />
              <span className="num">{t.tool}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{summariseArgs(t.args)}</span>
              {t.result && typeof (t.result as { count?: number }).count === "number" && (
                <span className="num text-[12px] text-muted">{(t.result as { count: number }).count} results</span>
              )}
            </button>
            {open === i && (
              <pre className="num mt-1 max-h-64 overflow-auto rounded-[6px] bg-[#0f0e12] p-3 text-[11px] leading-4 text-muted">
                {JSON.stringify({ args: t.args, result: t.result, error: t.error }, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function summariseArgs(args: Record<string, unknown>) {
  const v = args.query ?? args.filename ?? args.title ?? args.url;
  return v ? `“${String(v)}”` : Object.keys(args).join(", ");
}

function ResultCard({ run, sources }: { run: Run; sources: Source[] }) {
  const out = run.output;
  if (!out) {
    return (
      <Card title="Result">
        <p className="text-[13px] leading-5 text-muted">
          {["queued", "running", "awaiting_approval"].includes(run.status)
            ? "The final result appears here when the last agent finishes."
            : "This run ended without a result."}
        </p>
      </Card>
    );
  }
  return (
    <Card
      title="Result"
      sub={out.primary_node ? `From ${out.nodes[out.primary_node]?.label ?? out.primary_node}` : undefined}
      action={out.review ? <Pill tone={out.review.verdict === "approve" ? "positive" : "warning"}>{out.review.verdict === "approve" ? `Approved · ${out.review.score}/10` : "Needs work"}</Pill> : null}
    >
      <AgentMarkdown text={out.summary || "_No summary was produced._"} sources={sources} />
      {out.review?.revision_cap_reached && (
        <p className="mt-3 text-[12px] text-[var(--pill-warning-ink)]">The reviewer still wanted changes when the revision limit was reached.</p>
      )}
    </Card>
  );
}

function SourcesCard({ sources, cited }: { sources: Source[]; cited: Set<number> }) {
  return (
    <Card title="Sources" sub={sources.length ? `${sources.length} passages retrieved · ${cited.size} cited` : "Knowledge base"}>
      {sources.length === 0 ? (
        <p className="text-[13px] leading-5 text-muted">No passages were retrieved. Add documents to the knowledge base so agents can ground their answers.</p>
      ) : (
        <ol className="flex flex-col">
          {sources.slice(0, 8).map((s) => (
            <li key={s.chunk_id} id={`source-${s.n}`} className="border-t border-rule py-2.5 first:border-t-0 first:pt-0">
              <p className="flex items-center gap-2 text-[13px]">
                <span className={clsx("num flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 text-[11px]", cited.has(s.n) ? "bg-accent text-white" : "bg-raised text-muted")}>
                  {s.n}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.filename}</span>
                {s.page && <span className="num text-[12px] text-muted">p.{s.page}</span>}
              </p>
              <p className="mt-1 line-clamp-3 text-[12px] leading-[18px] text-muted">{plain(s.excerpt)}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ArtifactsCard({ run }: { run: Run }) {
  const [open, setOpen] = useState<string | null>(null);
  const download = (title: string, content: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card title="Artifacts" sub="Saved by the Execution agent">
      <ul className="flex flex-col gap-1">
        {run.artifacts.map((a) => (
          <li key={a.id}>
            <div className="flex items-center gap-2">
              <button onClick={() => setOpen(open === a.id ? null : a.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] px-1 py-1.5 text-left text-[13px] hover:bg-raised">
                <FileText className="size-4 flex-none text-muted" />
                <span className="truncate">{a.title}</span>
              </button>
              <button onClick={() => download(a.title, a.content)} aria-label={`Download ${a.title}`} className="rounded-full p-1.5 text-muted hover:bg-raised hover:text-text">
                <Download className="size-3.5" />
              </button>
            </div>
            {open === a.id && (
              <div className="mt-2 max-h-[360px] overflow-auto rounded-[6px] bg-[#0f0e12] p-3">
                <AgentMarkdown text={a.content} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EventLog({ events }: { events: LifecycleEvent[] }) {
  const rows = useMemo(() => [...events].reverse(), [events]);
  if (!rows.length) return <p className="text-[13px] text-muted">No events yet.</p>;
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--card-shadow)]">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th className="h-9 w-14 px-4 text-right font-normal">Seq</th>
            <th className="w-24 px-3 font-normal">Time</th>
            <th className="font-normal">Event</th>
            <th className="px-4 font-normal">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.event_id} className="border-t border-rule align-top">
              <td className="num px-4 py-2 text-right text-muted">{e.seq}</td>
              <td className="num px-3 py-2 text-muted">{fmtClock(e.occurred_at)}</td>
              <td className="num py-2">
                <span className={clsx(e.type.endsWith("failed") && "text-[var(--pill-negative-ink)]", e.type.startsWith("approval") && "text-[var(--pill-warning-ink)]")}>{e.type}</span>
              </td>
              <td className="max-w-[420px] truncate px-4 py-2 text-muted">{eventDetail(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function eventDetail(e: LifecycleEvent): string {
  const p = e.payload;
  if (p.label && p.attempt) return `${p.label} · attempt ${p.attempt}${p.error ? ` · ${p.error}` : ""}`;
  if (p.label) return `${p.label}${p.duration_ms ? ` · ${fmtDuration(p.duration_ms)}` : ""}`;
  if (p.tool) return `${p.tool}${p.args?.query ? ` “${p.args.query}”` : ""}${p.error ? ` · ${p.error}` : ""}`;
  if (p.target_label) return `→ ${p.target_label} (revision ${p.revision}/${p.max_revisions})`;
  if (p.error) return p.error;
  if (p.reason) return p.reason;
  if (p.status) return p.status;
  return "";
}
