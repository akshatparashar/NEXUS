"use client";

import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { ErrorNote, PageHeader, Skeleton } from "@/components/ui/primitives";
import { get } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { ConfigStatus } from "@/lib/types";

export default function SettingsPage() {
  const q = useQuery({ queryKey: ["config"], queryFn: () => get<ConfigStatus>("/health/config") });
  const ws = useSession((s) => s.workspaces.find((w) => w.id === s.workspaceId));
  const c = q.data;
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Settings" sub="What this NEXUS instance is connected to. Values come from environment variables; secrets are never shown." />
      {q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : !c ? (
        <Skeleton className="h-[400px] w-full" />
      ) : (
        <div className="flex flex-col">
          <Row title="Model provider" desc="Every agent calls this model unless a node overrides it.">
            <Status ok={c.llm.configured} label={c.llm.configured ? "Connected" : "Not configured"} />
            <KV k="Provider" v={c.llm.provider} />
            <KV k="Model" v={c.llm.model} />
            {!c.llm.configured && <Setup provider={c.llm.provider} />}
          </Row>
          <Row title="Embeddings" desc="Turns document chunks and queries into vectors for semantic search.">
            <Status ok label="Ready" />
            <KV k="Provider" v={c.embeddings.provider === "local" ? "local (fastembed, CPU)" : c.embeddings.provider} />
            <KV k="Model" v={c.embeddings.model} />
            <KV k="Dimensions" v={String(c.embeddings.dim)} />
          </Row>
          <Row title="Database" desc="PostgreSQL with pgvector stores runs, events, documents and vectors.">
            <Status ok={c.database.ok} label={c.database.ok ? "Healthy" : "Unreachable"} />
            <KV k="pgvector" v={c.database.pgvector ?? "—"} />
            <KV k="Latency" v={c.database.latency_ms != null ? `${c.database.latency_ms} ms` : "—"} />
          </Row>
          <Row title="Event pipeline" desc="Commands and lifecycle events travel through the bus; live updates fan out to browsers.">
            <Status ok={c.event_bus.ok} label={c.event_bus.ok ? "Running" : "Down"} />
            <KV k="Bus" v={c.event_bus.kind === "kafka" ? `Apache Kafka · ${c.event_bus.bootstrap}` : "in-process (no Kafka configured)"} />
            <KV k="Realtime" v={c.realtime.kind === "redis" ? "Redis pub/sub" : "in-process"} />
            <KV k="Process mode" v={c.run_mode} />
          </Row>
          <Row title="Guards" desc="Limits that keep agents from running away.">
            <KV k="Run timeout" v={`${fmtInt(c.limits.run_timeout_seconds)} s`} />
            <KV k="Step timeout" v={`${fmtInt(c.limits.node_timeout_seconds)} s`} />
            <KV k="Attempts per step" v={String(c.limits.node_max_attempts)} />
            <KV k="Revisions (hard cap)" v={String(c.limits.hard_max_revisions)} />
            <KV k="Token budget per run" v={fmtInt(c.limits.run_token_budget)} />
            <KV k="Upload limit" v={`${c.limits.max_upload_mb} MB · PDF, TXT, Markdown`} />
          </Row>
          <Row title="Workspace" desc="Everything you see is scoped to this workspace.">
            <KV k="Name" v={ws?.name ?? "—"} />
            <KV k="Your role" v={ws?.role ?? "—"} />
            <KV k="ID" v={ws?.id ?? "—"} copy />
          </Row>
        </div>
      )}
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-4 border-t border-rule py-8 first:border-t-0 first:pt-0 md:grid-cols-[320px_minmax(0,1fr)]">
      <div>
        <h2 className="text-[16px] font-medium">{title}</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted">{desc}</p>
      </div>
      <div className="panel rounded-[var(--radius-card)] px-5 py-3">{children}</div>
    </section>
  );
}

function KV({ k, v, copy }: { k: string; v: string; copy?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 border-t border-rule text-[13px] first:border-t-0">
      <span className="text-muted">{k}</span>
      <span className="num flex min-w-0 items-center gap-2 truncate text-right">
        <span className="truncate">{v}</span>
        {copy && (
          <button
            aria-label={`Copy ${k}`}
            onClick={() => {
              navigator.clipboard?.writeText(v);
              setDone(true);
              setTimeout(() => setDone(false), 1200);
            }}
            className="text-muted hover:text-text"
          >
            {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        )}
      </span>
    </div>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex min-h-9 items-center justify-between text-[13px]">
      <span className="text-muted">Status</span>
      <span className={clsx("flex items-center gap-2", ok ? "text-[var(--pill-positive-ink)]" : "text-[var(--pill-warning-ink)]")}>
        <span className={clsx("size-1.5 rounded-full", ok ? "bg-positive" : "bg-warning")} />
        {label}
      </span>
    </div>
  );
}

function Setup({ provider }: { provider: string }) {
  const lines =
    provider === "anthropic"
      ? ["LLM_PROVIDER=anthropic", "LLM_MODEL=claude-sonnet-5-5", "ANTHROPIC_API_KEY=sk-ant-…"]
      : provider === "ollama"
        ? ["LLM_PROVIDER=ollama", "LLM_MODEL=qwen2.5:7b", "OLLAMA_BASE_URL=http://localhost:11434"]
        : ["LLM_PROVIDER=openai", "LLM_MODEL=gpt-4.1-mini", "OPENAI_API_KEY=sk-…"];
  return (
    <div className="mb-2 mt-3 rounded-[8px] bg-[var(--pill-warning-bg)] p-3 text-[13px]">
      <p className="text-[var(--pill-warning-ink)]">Agents can&apos;t run until a model is configured. Add these to <span className="num">.env</span> and restart the API:</p>
      <pre className="num mt-2 overflow-x-auto rounded-[6px] bg-black/30 p-2.5 text-[12px] leading-5 text-text">{lines.join("\n")}</pre>
      <p className="mt-2 text-[12px] text-muted">No key? Set LLM_PROVIDER=ollama and run a local model for free.</p>
    </div>
  );
}
