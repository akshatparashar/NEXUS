"use client";

import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENTS } from "@/lib/agents";
import { fmtDuration, niceTicks } from "@/lib/format";
import type { Graph, LifecycleEvent, Step } from "@/lib/types";

/**
 * The run tape: one lane per agent, time across. Each bar is one attempt of one step.
 * Running = violet (a model is generating), revisions = a second tone, failed attempts = hatched red,
 * waiting for approval = amber outline. Tool calls are ticks on the lane at the moment they happened.
 */
export function RunTape({
  graph,
  steps,
  events = [],
  startedAt,
  finishedAt,
  selectedStep,
  onSelectStep,
  compact = false,
}: {
  graph: Graph;
  steps: Step[];
  events?: LifecycleEvent[];
  startedAt: string | null;
  finishedAt: string | null;
  selectedStep?: string | null;
  onSelectStep?: (id: string) => void;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [now, setNow] = useState(() => Date.now());
  const live = !finishedAt && !!startedAt;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [live]);

  const lanes = useMemo(() => {
    const order = graph.nodes.map((n) => n.id);
    const seen = new Set(order);
    for (const s of steps) {
      if (!seen.has(s.node_id)) {
        order.push(s.node_id);
        seen.add(s.node_id);
      }
    }
    return order.map((id) => {
      const node = graph.nodes.find((n) => n.id === id);
      return { id, label: node?.data.label ?? steps.find((s) => s.node_id === id)?.label ?? id, type: node?.type ?? steps.find((s) => s.node_id === id)?.agent_type ?? "research" };
    });
  }, [graph, steps]);

  const t0 = startedAt ? new Date(startedAt).getTime() : steps.length ? Math.min(...steps.map((s) => new Date(s.started_at).getTime())) : now;
  const tEnd = finishedAt ? new Date(finishedAt).getTime() : Math.max(now, ...steps.map((s) => (s.finished_at ? new Date(s.finished_at).getTime() : now)));
  const span = Math.max(1000, tEnd - t0);
  const ticks = niceTicks(0, span / 1000, width < 520 ? 3 : 5).filter((v) => v * 1000 <= span * 1.0001 || v === 0);
  const top = ticks[ticks.length - 1] ?? span / 1000;
  const scaleMax = Math.max(span / 1000, top) * 1000;

  const labelW = compact ? 96 : 132;
  const laneH = compact ? 26 : 34;
  const barH = compact ? 12 : 16;
  const plotW = width - labelW - 8;
  const x = (t: number) => labelW + ((t - t0) / scaleMax) * plotW;
  const h = lanes.length * laneH + 24;

  const toolTicks = events.filter((e) => e.type === "tool.called");

  return (
    <div ref={ref} className="w-full" data-ui>
      <svg width={width} height={h} role="img" aria-label={`Timeline of ${steps.length} steps across ${lanes.length} agents, ${fmtDuration(span)} in total`}>
        <defs>
          <pattern id="tape-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--negative)" strokeWidth="1.4" />
          </pattern>
        </defs>
        {/* gridlines + ticks */}
        {ticks.map((v) => {
          const gx = labelW + ((v * 1000) / scaleMax) * plotW;
          return (
            <g key={v}>
              <line x1={gx} x2={gx} y1={0} y2={h - 20} stroke="var(--grid)" strokeWidth={1} />
              <text x={gx} y={h - 6} fill="var(--muted)" fontSize={11} textAnchor={v === 0 ? "start" : "middle"} className="num">
                {v === 0 ? "0 s" : `${v} s`}
              </text>
            </g>
          );
        })}
        {lanes.map((lane, i) => {
          const y = i * laneH + (laneH - barH) / 2;
          const laneSteps = steps.filter((s) => s.node_id === lane.id);
          const meta = AGENTS[lane.type as keyof typeof AGENTS];
          return (
            <g key={lane.id}>
              <circle cx={6} cy={i * laneH + laneH / 2} r={3} fill={meta?.hue ?? "var(--muted)"} />
              <text x={16} y={i * laneH + laneH / 2 + 4} fill="var(--text)" fontSize={12}>
                {truncate(lane.label, compact ? 11 : 16)}
              </text>
              {laneSteps.map((s) => {
                const a = new Date(s.started_at).getTime();
                const b = s.finished_at ? new Date(s.finished_at).getTime() : s.status === "running" || s.status === "awaiting_approval" ? tEnd : a + (s.duration_ms ?? 0);
                const bx = x(a);
                const bw = Math.max(3, x(b) - bx);
                const sel = selectedStep === s.id;
                let fill = s.iteration > 1 ? "#9fa3ab" : "var(--chart-1)";
                if (s.status === "running") fill = meta?.hue ?? "var(--thinking)"; // the agent working now, in its own colour
                if (s.status === "failed") fill = "url(#tape-hatch)";
                if (s.status === "cancelled") fill = "#3a3a3e";
                return (
                  <g
                    key={s.id}
                    onClick={onSelectStep ? () => onSelectStep(s.id) : undefined}
                    className={clsx(onSelectStep && "cursor-pointer")}
                    role={onSelectStep ? "button" : undefined}
                    aria-label={`${s.label}, attempt ${s.attempt}, ${s.status}, ${fmtDuration(s.duration_ms ?? b - a)}`}
                  >
                    <title>{`${s.label} · ${s.iteration > 1 ? `revision ${s.iteration - 1} · ` : ""}${s.attempt > 1 ? `attempt ${s.attempt} · ` : ""}${s.status} · ${fmtDuration(s.duration_ms ?? b - a)}`}</title>
                    <rect
                      x={bx}
                      y={y}
                      width={bw}
                      height={barH}
                      rx={2}
                      fill={s.status === "awaiting_approval" ? "transparent" : fill}
                      stroke={s.status === "awaiting_approval" ? "var(--warning)" : s.status === "failed" ? "var(--negative)" : "none"}
                      strokeDasharray={s.status === "awaiting_approval" ? "3 3" : undefined}
                      opacity={s.status === "running" ? 0.9 : 1}
                      className={s.status === "running" ? "animate-[nexus-breathe_1.4s_infinite]" : undefined}
                    />
                    {sel && <rect x={bx - 2} y={y - 2} width={bw + 4} height={barH + 4} rx={3} fill="none" stroke="var(--accent)" strokeWidth={1} />}
                  </g>
                );
              })}
              {toolTicks
                .filter((e) => e.payload.node_id === lane.id)
                .map((e) => {
                  const tx = x(new Date(e.occurred_at).getTime());
                  return (
                    <line key={e.event_id} x1={tx} x2={tx} y1={y + barH + 2} y2={y + barH + 6} stroke={e.payload.destructive ? "var(--warning)" : "var(--accent)"} strokeWidth={1.5}>
                      <title>{`${e.payload.tool}${e.payload.error ? ` — ${e.payload.error}` : ""}`}</title>
                    </line>
                  );
                })}
            </g>
          );
        })}
        {live && <line x1={x(now)} x2={x(now)} y1={0} y2={h - 20} stroke="var(--thinking)" strokeWidth={1} strokeDasharray="2 3" />}
      </svg>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function TapeLegend() {
  const item = (swatch: React.ReactNode, label: string) => (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
      {item(<span className="h-2 w-4 rounded-[2px] bg-[var(--chart-1)]" />, "Step")}
      {item(<span className="h-2 w-4 rounded-[2px] bg-[#9fa3ab]" />, "Revision")}
      {item(<span className="spectrum-flow h-2 w-4 rounded-[2px]" />, "Generating")}
      {item(
        <svg width="16" height="8" aria-hidden>
          <rect width="16" height="8" rx="2" fill="url(#legend-hatch)" stroke="var(--negative)" />
          <defs>
            <pattern id="legend-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--negative)" strokeWidth="1.2" />
            </pattern>
          </defs>
        </svg>,
        "Failed attempt",
      )}
      {item(<span className="h-2 w-4 rounded-[2px] border border-dashed border-warning" />, "Waiting for approval")}
      {item(<span className="h-2.5 w-px bg-accent" />, "Tool call")}
    </div>
  );
}
