"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Check, Play, RotateCcw, Search, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentTile } from "@/components/agent-tile";
import { AGENTS } from "@/lib/agents";
import type { AgentType } from "@/lib/types";
import { type Beat, TRACES, type Trace } from "./traces";

const ORDER: AgentType[] = ["research", "analyst", "execution", "reviewer"];
type NodeState = { status: "idle" | "running" | "done" | "waiting"; revision: number };
type Phase = "ready" | "playing" | "approval" | "done";

/**
 * The hero's working fragment: a recorded run replayed on a real miniature of the builder canvas.
 * The visitor chooses the task, presses Run, and makes the approval decision themselves.
 */
export function HeroRun() {
  const [traceId, setTraceId] = useState(TRACES[0].id);
  const trace = TRACES.find((t) => t.id === traceId) as Trace;
  const [phase, setPhase] = useState<Phase>("ready");
  const [clock, setClock] = useState(0);
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const raf = useRef<number | null>(null);
  const base = useRef(0); // wall-clock origin of playback
  const pausedAt = useRef<number | null>(null);
  const decisionRef = useRef<"approved" | "rejected" | null>(null);

  const approvalBeat = trace.beats.find((b) => b.kind === "approval");
  const end = trace.beats[trace.beats.length - 1].at + 400;

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const tick = useCallback(() => {
    const t = performance.now() - base.current;
    if (approvalBeat && t >= approvalBeat.at && pausedAt.current === null && !decisionRef.current) {
      pausedAt.current = approvalBeat.at;
      setClock(approvalBeat.at);
      setPhase("approval");
      stop();
      return;
    }
    if (t >= end) {
      setClock(end);
      setPhase("done");
      stop();
      return;
    }
    setClock(t);
    raf.current = requestAnimationFrame(tick);
  }, [approvalBeat, end]);

  const play = () => {
    stop();
    decisionRef.current = null;
    setDecision(null);
    pausedAt.current = null;
    base.current = performance.now();
    setClock(0);
    setPhase("playing");
    raf.current = requestAnimationFrame(tick);
  };

  const decide = (d: "approved" | "rejected") => {
    decisionRef.current = d;
    setDecision(d);
    base.current = performance.now() - (pausedAt.current ?? 0);
    setPhase("playing");
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => stop(), []);
  useEffect(() => {
    stop();
    setPhase("ready");
    setClock(0);
    setDecision(null);
  }, [traceId]);

  // derive the canvas state at `clock`
  const { nodes, current, texts, tools, revise } = useMemo(() => {
    const nodes: Record<AgentType, NodeState> = {
      research: { status: "idle", revision: 0 },
      analyst: { status: "idle", revision: 0 },
      execution: { status: "idle", revision: 0 },
      reviewer: { status: "idle", revision: 0 },
    };
    let current: AgentType | null = null;
    const texts: { node: AgentType; text: string; at: number; full: boolean }[] = [];
    const tools: { tool: string; arg: string; result: string }[] = [];
    let revise: { to: AgentType; feedback: string } | null = null;
    if (phase === "ready") return { nodes, current, texts, tools, revise };
    for (const b of trace.beats as Beat[]) {
      if (b.at > clock) break;
      if (b.kind === "start") {
        nodes[b.node].status = "running";
        if (b.note) nodes[b.node].revision += 1;
        current = b.node;
      } else if (b.kind === "done") nodes[b.node].status = "done";
      else if (b.kind === "text") {
        const chars = Math.floor((clock - b.at) / 22);
        texts.push({ node: b.node, text: b.text.slice(0, chars), at: b.at, full: chars >= b.text.length });
      } else if (b.kind === "tool") tools.push({ tool: b.tool, arg: b.arg, result: b.result });
      else if (b.kind === "revise") {
        nodes.reviewer.status = "done";
        revise = { to: b.to, feedback: b.feedback };
      } else if (b.kind === "approval") nodes.execution.status = decision ? "running" : "waiting";
    }
    return { nodes, current, texts, tools, revise };
  }, [clock, phase, trace, decision]);

  const last = texts[texts.length - 1];
  const seconds = (clock / 1000).toFixed(1);

  return (
    <div data-ui className="w-full max-w-[560px] select-none rounded-[14px] bg-surface p-4 text-[13px] text-text shadow-[0_24px_64px_rgb(0_0_0_/_0.45)] sm:p-5">
      {/* task chooser */}
      <div className="flex items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Choose a task" className="flex min-w-0 flex-wrap items-center gap-x-4">
          {TRACES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={t.id === traceId}
              onClick={() => setTraceId(t.id)}
              className={clsx("relative h-7 flex-none whitespace-nowrap text-[13px] transition-colors", t.id === traceId ? "text-text" : "text-muted hover:text-text")}
            >
              {t.label}
              <span className={clsx("absolute inset-x-0 bottom-0 h-px bg-accent transition-opacity", t.id === traceId ? "opacity-100" : "opacity-0")} />
            </button>
          ))}
        </div>
        <span className="num flex-none text-[12px] text-muted">{phase === "ready" ? "0.0 s" : `${seconds} s`}</span>
      </div>
      <p className="mt-3 min-h-10 text-[13px] leading-5 text-muted">
        <span className="text-text">Task.</span> {trace.task}
      </p>

      {/* the canvas */}
      <div className="relative mt-3 rounded-[10px] bg-well px-3 pb-4 pt-9">
        <svg className="pointer-events-none absolute inset-x-3 top-1 h-9 w-[calc(100%-24px)]" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
          <path
            d="M 87.5 34 C 87.5 6, 37.5 6, 37.5 34"
            fill="none"
            stroke={revise && nodes.analyst.revision > 0 && nodes.analyst.status !== "done" ? "var(--thinking)" : "#55555c"}
            strokeWidth="0.6"
            strokeDasharray="1.6 1.6"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className="absolute left-1/2 top-1.5 -translate-x-1/2 text-[11px] text-muted">{revise ? `revise · “${revise.feedback}”` : "revise · up to 2"}</span>
        <div className="grid grid-cols-4 gap-2">
          {ORDER.map((t, i) => (
            <div key={t} className="relative">
              <MiniNode type={t} state={nodes[t]} />
              {i < 3 && (
                <span
                  className={clsx(
                    "absolute -right-2 top-1/2 h-px w-2",
                    nodes[ORDER[i + 1]].status !== "idle" && nodes[t].status === "done" ? "bg-[#8a8c92]" : "bg-[#3a3a3e]",
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* readout */}
      <div className="mt-3 min-h-[132px] rounded-[10px] bg-[#0f0e12] p-3.5" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {phase === "ready" && (
            <motion.div key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-[104px] flex-col justify-between">
              <p className="leading-5 text-muted">Four agents will research your documents, analyse the findings, act on them and review the result. Press Run to watch.</p>
              <button onClick={play} className="flex w-fit items-center gap-2 rounded-full bg-[#f2f2f3] px-4 py-1.5 text-[13px] font-medium text-[#111114] transition-transform active:scale-[0.97]">
                <Play className="size-3.5" /> Run
              </button>
            </motion.div>
          )}
          {phase === "approval" && approvalBeat?.kind === "approval" && (
            <motion.div key="approval" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-3">
              <p className="flex items-start gap-2 leading-5">
                <ShieldAlert className="mt-0.5 size-4 flex-none text-warning" />
                <span>
                  <span className="font-medium">The Execution agent wants to {approvalBeat.action === "send_webhook" ? `post to ${approvalBeat.file}` : `delete ${approvalBeat.file}`}.</span>{" "}
                  <span className="text-muted">{approvalBeat.reason} The run is paused until you decide.</span>
                </span>
              </p>
              <div className="flex gap-2">
                <button onClick={() => decide("approved")} className="rounded-full bg-[#f2f2f3] px-4 py-1.5 text-[13px] font-medium text-[#111114] transition-transform active:scale-[0.97]">
                  Approve
                </button>
                <button onClick={() => decide("rejected")} className="rounded-full border border-control px-4 py-1.5 text-[13px] transition-colors hover:bg-raised active:scale-[0.97]">
                  Reject
                </button>
              </div>
            </motion.div>
          )}
          {phase === "playing" && (
            <motion.div key="playing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="flex items-center gap-2 text-[12px] text-[var(--pill-thinking-ink)]">
                <span className="thinking-dot" />
                {current ? `${AGENTS[current].verb}${nodes[current].revision ? ` · revision ${nodes[current].revision}` : ""}` : "Starting"}
              </p>
              {current === "research" && tools.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {tools.map((t, i) => (
                    <li key={i} className="flex items-center gap-2 text-[12px] text-muted">
                      <Search className="size-3 text-accent-ink" />
                      <span className="num text-text">{t.tool}</span> “{t.arg}” → {t.result}
                    </li>
                  ))}
                </ul>
              )}
              {last && last.node === current && <p className={clsx("mt-2 leading-5", !last.full && "caret")}>{last.text}</p>}
            </motion.div>
          )}
          {phase === "done" && (
            <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <p className="flex items-center gap-2 text-[12px] text-[var(--pill-positive-ink)]">
                <Check className="size-3.5" /> Reviewer approved · {trace.result.score}/10 · {seconds} s
              </p>
              <p className="mt-2 leading-5">
                {withCites(decision === "rejected" ? trace.result.rejected : trace.result.approved)}
              </p>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <p className="num truncate text-[11px] text-muted">
                  {trace.result.sources.map((s) => `[${s.n}] ${s.file} p.${s.page}`).join("   ")}
                </p>
                <button onClick={play} className="flex flex-none items-center gap-1.5 text-[12px] text-muted hover:text-text">
                  <RotateCcw className="size-3" /> Replay
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="mt-2.5 text-[11px] text-muted">A recorded run, replayed in the real canvas components. Your decision changes the outcome.</p>
    </div>
  );
}

function withCites(text: string) {
  return text.split(/(\[\d+\])/).map((part, i) =>
    /^\[\d+\]$/.test(part) ? (
      <span key={i} className="num mx-0.5 rounded-[4px] bg-[var(--pill-accent-bg)] px-1 text-[11px] text-[var(--pill-accent-ink)]">
        {part.slice(1, -1)}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function MiniNode({ type, state }: { type: AgentType; state: NodeState }) {
  const meta = AGENTS[type];
  return (
    <div
      className={clsx(
        "rounded-[8px] border bg-surface px-2 py-2 transition-[border-color] duration-300",
        state.status === "running" ? "border-thinking" : state.status === "waiting" ? "border-warning" : "border-[#2a292e]",
      )}
    >
      <div className="flex items-center gap-1.5">
        <AgentTile type={type} size={18} />
        <span className="truncate text-[12px] font-medium">{meta.label}</span>
      </div>
      <p className="mt-1.5 flex h-4 items-center gap-1 text-[11px]">
        {state.status === "running" && (
          <>
            <span className="thinking-dot" />
            <span className="text-[var(--pill-thinking-ink)]">{state.revision ? `rev ${state.revision}` : "working"}</span>
          </>
        )}
        {state.status === "done" && (
          <span className="flex items-center gap-1 text-[var(--pill-positive-ink)]">
            <Check className="size-3" /> done
          </span>
        )}
        {state.status === "waiting" && <span className="text-[var(--pill-warning-ink)]">needs you</span>}
        {state.status === "idle" && <span className="text-muted">idle</span>}
      </p>
    </div>
  );
}
