"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { clsx } from "clsx";
import { AlertTriangle, Check, RotateCcw } from "lucide-react";
import { memo } from "react";
import { AgentTile } from "@/components/agent-tile";
import { AGENTS } from "@/lib/agents";
import { fmtDuration } from "@/lib/format";
import type { AgentType, NodeData } from "@/lib/types";
import type { NodeLive } from "@/lib/use-run";

export type AgentNodeData = NodeData & {
  agentType: AgentType;
  live?: NodeLive | null;
  stream?: string;
};

export type AgentFlowNode = Node<AgentNodeData>;

function rows(d: AgentNodeData): [string, string][] {
  const out: [string, string][] = [];
  if (d.agentType === "research") out.push(["Passages per query", String(d.topK ?? 6)]);
  if (d.agentType === "execution") out.push(["Tools", d.tools?.length ? `${d.tools.length} allowed` : "All"]);
  if (d.agentType === "reviewer") out.push(["Max revisions", String(d.maxRevisions ?? 2)]);
  out.push(["Temperature", d.temperature == null ? "Default" : String(d.temperature)]);
  return out;
}

function AgentNodeImpl({ data, selected }: NodeProps<AgentFlowNode>) {
  const meta = AGENTS[data.agentType];
  const live = data.live;
  const status = live?.status ?? "idle";
  const thinking = status === "running";

  return (
    <div
      className={clsx(
        "w-[248px] rounded-[16px] border bg-surface text-left transition-[border-color,box-shadow] duration-300",
        selected ? "border-accent" : status === "failed" ? "border-[rgb(255_90_82_/_0.45)]" : status === "awaiting_approval" ? "border-[rgb(255_163_26_/_0.45)]" : "border-white/[0.08]",
        !thinking && "shadow-[0_8px_24px_rgb(0_0_0_/_0.28)]",
      )}
      style={
        thinking && !selected
          ? { borderColor: meta.hue, boxShadow: `0 0 0 4px color-mix(in oklab, ${meta.hue} 18%, transparent), 0 14px 40px color-mix(in oklab, ${meta.hue} 28%, transparent)` }
          : undefined
      }
    >
      <Handle type="target" position={Position.Left} aria-label="Input" />
      <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
        <AgentTile type={data.agentType} size={26} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-5">{data.label || meta.label}</p>
          <p className="truncate text-[11px] leading-4 text-muted">{meta.label} agent</p>
        </div>
        <NodeStatus live={live} />
      </div>
      {thinking ? (
        <div className="mx-2 mb-2 rounded-[10px] bg-black/40 px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-[11px]" style={{ color: meta.hue }}>
            <span className="thinking-dot" style={{ background: meta.hue }} /> {meta.verb}
            {live && live.iterations > 1 ? ` · revision ${live.iterations - 1}` : ""}
            {live?.step && live.step.attempt > 1 ? ` · attempt ${live.step.attempt}` : ""}
          </p>
          {data.stream ? (
            <p className="caret mt-1 line-clamp-3 text-[12px] leading-[17px] text-text/85">{streamTail(data.stream)}</p>
          ) : (
            <p className="mt-1 text-[12px] text-muted">{data.agentType === "research" ? "Searching the knowledge base…" : "Thinking…"}</p>
          )}
        </div>
      ) : (
        <dl className="mx-2 mb-2 rounded-[6px] bg-[#0f0e12] px-2.5 py-1">
          {status !== "idle" && live?.step ? (
            <>
              <Row k="Last step" v={fmtDuration(live.step.duration_ms)} />
              <Row k="Tokens" v={String((live.step.tokens_in ?? 0) + (live.step.tokens_out ?? 0))} />
              {live.iterations > 1 && <Row k="Revisions" v={String(live.iterations - 1)} />}
            </>
          ) : (
            rows(data).map(([k, v]) => <Row key={k} k={k} v={v} />)
          )}
        </dl>
      )}
      <Handle type="source" position={Position.Right} aria-label="Output" />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex h-[26px] items-center justify-between gap-2 text-[12px]">
      <dt className="text-muted">{k}</dt>
      <dd className="num text-text">{v}</dd>
    </div>
  );
}

function NodeStatus({ live }: { live?: NodeLive | null }) {
  if (!live) return null;
  switch (live.status) {
    case "succeeded":
      return (
        <span className="flex size-5 items-center justify-center rounded-full bg-[var(--pill-positive-bg)] text-[var(--pill-positive-ink)]" title="Done">
          <Check className="size-3" />
        </span>
      );
    case "failed":
      return (
        <span className="flex size-5 items-center justify-center rounded-full bg-[var(--pill-negative-bg)] text-[var(--pill-negative-ink)]" title="Failed">
          {live.step && live.step.attempt < 3 ? <RotateCcw className="size-3" /> : <AlertTriangle className="size-3" />}
        </span>
      );
    case "awaiting_approval":
      return <span className="rounded-full bg-[var(--pill-warning-bg)] px-2 py-0.5 text-[11px] text-[var(--pill-warning-ink)]">Approve</span>;
    case "running":
      return <span className="thinking-dot" title="Generating" />;
    default:
      return null;
  }
}

export const AgentNode = memo(AgentNodeImpl);

/** The last ~160 characters of a live stream, starting at a word boundary. */
function streamTail(text: string, n = 160): string {
  if (text.length <= n) return text;
  const cut = text.slice(-n);
  const space = cut.indexOf(" ");
  return `…${space >= 0 ? cut.slice(space + 1) : cut}`;
}
