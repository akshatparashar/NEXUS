"use client";

import { clsx } from "clsx";
import { ArrowRight, Check, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AgentTile } from "@/components/agent-tile";
import { Switch } from "@/components/ui/primitives";
import type { AgentType } from "@/lib/types";

/* ── reveal: parts of each section rise in, staggered, once (content stays visible without JS) ── */

export function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal]"));
    const vh = window.innerHeight;
    items.forEach((it) => {
      if (it.getBoundingClientRect().top < vh * 0.92) it.classList.add("is-in");
    });
    el.classList.add("reveal-ready");
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((it) => !it.classList.contains("is-in") && io.observe(it));
    return () => io.disconnect();
  }, []);
  return root;
}

/* ── 1. The board: runs set like a departure board ─────────────────────────────── */

type Status = "Succeeded" | "Running" | "Needs you" | "Failed" | "Queued";
const BOARD: { name: string; agents: number; time: string; tokens: string; status: Status; detail: string; note: string }[] = [
  { name: "Vendor due diligence", agents: 4, time: "1 m 12 s", tokens: "18,402", status: "Succeeded", detail: "", note: "" },
  { name: "Weekly churn brief", agents: 3, time: "0 m 41 s", tokens: "9,880", status: "Running", detail: "", note: "" },
  { name: "Policy cleanup", agents: 4, time: "0 m 27 s", tokens: "6,215", status: "Needs you", detail: "", note: "" },
  {
    name: "Contract risk scan",
    agents: 4,
    time: "0 m 31 s",
    tokens: "14,077",
    status: "Succeeded",
    detail: "The reviewer sent the analysis back once: “quantify the exit penalty”. Revision 1 was approved at 9/10.",
    note: "6 passages cited from msa-2026.pdf · report saved · 1 deletion approved by a person",
  },
  { name: "Board pack summary", agents: 3, time: "2 m 03 s", tokens: "22,610", status: "Failed", detail: "", note: "" },
  { name: "Onboarding FAQ refresh", agents: 2, time: "0 m 19 s", tokens: "4,302", status: "Succeeded", detail: "", note: "" },
  { name: "Competitor pricing", agents: 4, time: "—", tokens: "—", status: "Queued", detail: "", note: "" },
  { name: "Incident review 11-07", agents: 4, time: "0 m 26 s", tokens: "11,940", status: "Succeeded", detail: "", note: "" },
];
const DETAIL: Record<string, [string, string]> = {
  "Vendor due diligence": ["Three vendors compared on 14 criteria; the reviewer approved on the first pass at 8/10.", "11 passages cited from 3 documents · report saved"],
  "Weekly churn brief": ["The Analyst is writing now: churn rose in accounts without SSO, mostly in their second month.", "Research finished in 9.8 s · 4 queries, 18 passages"],
  "Policy cleanup": ["The Execution agent wants to delete two superseded policy PDFs and is waiting for a person to approve.", "Nothing has been deleted · paused at a LangGraph interrupt"],
  "Board pack summary": ["The Analyst timed out after 3 attempts while the model provider was rate-limiting.", "Retry continues from the last checkpoint; Research is not redone"],
  "Onboarding FAQ refresh": ["Two agents rewrote 12 answers from the new help-centre export.", "8 passages cited · approved at 9/10"],
  "Competitor pricing": ["Waiting for a worker slot. It starts when one of the four concurrent runs finishes.", "Command sits in nexus.commands, partitioned by run id"],
  "Incident review 11-07": ["Postmortem summarised; automated certificate renewal ranked as the follow-up that prevents a repeat.", "Posted to #incidents after approval"],
};

const statusBlock: Record<Status, string> = {
  Succeeded: "bg-[#2f7a61] text-white",
  Running: "bg-thinking text-[#140f24]",
  "Needs you": "bg-warning text-[#231a06]",
  Failed: "bg-negative text-[#2a0a10]",
  Queued: "bg-[#4a4a50] text-white",
};

export function RunBoard() {
  const [open, setOpen] = useState(3);
  return (
    <section aria-labelledby="board-h" className="relative py-[140px]">
      <div className="mx-auto mb-12 max-w-[1440px] px-5 md:px-10">
        <h2 id="board-h" data-reveal className="max-w-[18ch] text-[clamp(34px,3.6vw,52px)] font-medium leading-[1.02] tracking-[-0.03em]">
          Every run, on one board.
        </h2>
        <p data-reveal style={{ "--d": "80ms" } as React.CSSProperties} className="mt-5 max-w-[52ch] text-[17px] leading-[27px] text-[#d4d5d9]">
          Runs update the moment an agent starts, calls a tool, asks for a revision or waits for you. Choose a row to see what happened inside it.
        </p>
      </div>
      <div data-ui data-reveal style={{ "--d": "160ms" } as React.CSSProperties} className="relative overflow-hidden px-3">
        <ul className="flex flex-col gap-1 py-[36px]" role="list">
          {BOARD.map((r, i) => {
            const isOpen = i === open;
            const [detail, note] = r.detail ? [r.detail, r.note] : DETAIL[r.name];
            return (
              <li key={r.name} data-reveal style={{ "--d": `${i * 60}ms` } as React.CSSProperties}>
                <button
                  onClick={() => setOpen(i)}
                  aria-expanded={isOpen}
                  className={clsx(
                    "grid w-full grid-cols-[1fr_auto] items-center gap-4 rounded-[6px] px-4 text-left transition-[background-color,height] duration-300 ease-[var(--ease)] md:grid-cols-12 md:px-6",
                    isOpen ? "h-[216px] bg-[#2f66d9] text-white" : "h-16 bg-[#1e1d22] hover:bg-[#252429] md:h-[72px]",
                  )}
                >
                  <span className={clsx("truncate font-medium tracking-[-0.02em] md:col-span-5", isOpen ? "self-start pt-6 text-[clamp(22px,1.95vw,28px)]" : "text-[20px] md:text-[clamp(20px,1.95vw,28px)]")}>
                    {r.name}
                    {isOpen && (
                      <span className="mt-4 block max-w-[52ch] whitespace-normal text-[17px] font-normal leading-[26px] tracking-normal text-white/90">
                        {detail}
                        <span className="mt-2 block text-[15px] text-white/85">{note}</span>
                      </span>
                    )}
                  </span>
                  <span className={clsx("hidden tabular-nums md:col-span-2 md:block", isOpen ? "self-start pt-7 text-[17px] text-white/85" : "text-[17px] text-muted")}>{r.agents} agents</span>
                  <span className={clsx("hidden tabular-nums md:col-span-2 md:block", isOpen ? "self-start pt-7 text-[17px] text-white/85" : "text-[17px] text-muted")}>{r.time}</span>
                  <span className={clsx("hidden tabular-nums md:col-span-2 md:block", isOpen ? "self-start pt-7 text-[17px] text-white/85" : "text-[17px] text-muted")}>{r.tokens}</span>
                  <span className={clsx("justify-self-end md:col-span-1", isOpen && "self-start pt-6")}>
                    <span className={clsx("inline-flex h-8 items-center whitespace-nowrap rounded-[4px] px-3 text-[14px] font-medium", isOpen ? "bg-white text-[#0b1a3a]" : statusBlock[r.status])}>{r.status}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ── 2. Fixed output, live controls ────────────────────────────────────────────── */

type Team = "research" | "analyst" | "full";

export function LiveControls() {
  const [grounded, setGrounded] = useState(true);
  const [revisions, setRevisions] = useState(2);
  const [team, setTeam] = useState<Team>("full");
  const [canDelete, setCanDelete] = useState(true);

  const agents: AgentType[] = team === "research" ? ["research", "reviewer"] : team === "analyst" ? ["research", "analyst", "reviewer"] : ["research", "analyst", "execution", "reviewer"];
  const used = Math.min(revisions, 1);
  const score = revisions === 0 ? 7 : 9;

  return (
    <section aria-labelledby="controls-h" className="relative">
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 md:grid-cols-12">
        {/* the fixed output on a flat stage */}
        <div className="sticky top-0 z-0 flex h-[46svh] items-center justify-center overflow-hidden bg-[#2a56c6] px-5 md:col-span-6 md:h-[100svh]">
          <article data-ui className="w-full max-w-[420px] rounded-[12px] bg-surface p-5 text-[13px] shadow-[0_24px_64px_rgb(0_0_0_/_0.35)]" aria-live="polite">
            <header className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-semibold">Pricing brief</p>
                <p className="text-[12px] text-muted">Result · {agents.length} agents</p>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-[var(--pill-positive-bg)] px-2 py-0.5 text-[11px] text-[var(--pill-positive-ink)]">
                <Check className="size-3" /> Approved {score}/10
              </span>
            </header>
            <div className="mt-3 flex items-center gap-1.5">
              {agents.map((a) => (
                <AgentTile key={a} type={a} size={20} />
              ))}
              <span className="ml-1 text-[12px] text-muted">{revisions === 0 ? "no revisions allowed" : `revised ${used}× of up to ${revisions}`}</span>
            </div>
            <p className="mt-4 leading-[21px]">
              {team === "research" ? (
                <>Team costs €24 per seat and Business €41{grounded ? <Cite n={1} /> : null}. Seven of twelve interviewees named SSO as the reason to upgrade{grounded ? <Cite n={3} /> : null}.</>
              ) : (
                <>
                  Add a €32 tier with SSO: 7 of 12 interviewees upgrade for SSO alone{grounded ? <Cite n={3} /> : null}, and €41 is a 71% jump from Team{grounded ? <Cite n={1} /> : null}.
                  {revisions > 0 && " The reviewer asked for the interview count behind this, so it is stated."}
                </>
              )}
            </p>
            {!grounded && (
              <p className="mt-3 rounded-[6px] bg-[var(--pill-warning-bg)] px-2.5 py-1.5 text-[12px] text-[var(--pill-warning-ink)]">Not grounded: these figures come from the model, not your documents.</p>
            )}
            {grounded && (
              <ul className="mt-4 flex flex-col gap-1 border-t border-rule pt-3">
                <li className="num flex items-center gap-2 text-[11px] text-muted">
                  <Cite n={1} /> pricing-2026.pdf · p.2
                </li>
                <li className="num flex items-center gap-2 text-[11px] text-muted">
                  <Cite n={3} /> interviews-q3.md
                </li>
              </ul>
            )}
            {team === "full" && (
              <div className="mt-4 flex items-center gap-2 rounded-[8px] bg-[#0f0e12] px-3 py-2 text-[12px]">
                {canDelete ? (
                  <>
                    <ShieldAlert className="size-3.5 text-warning" />
                    <span className="flex-1">delete price-sheet-2025.pdf</span>
                    <span className="text-[var(--pill-warning-ink)]">waiting for you</span>
                  </>
                ) : (
                  <>
                    <Check className="size-3.5 text-positive" />
                    <span className="flex-1">save_report “Pricing brief”</span>
                    <span className="text-muted">done</span>
                  </>
                )}
              </div>
            )}
          </article>
        </div>

        {/* the reading column with real controls */}
        <div className="relative z-10 bg-ground px-5 md:col-span-6 md:px-0">
          <div className="mx-auto max-w-[44ch] pb-[18vh] pt-[72px] md:ml-[16%] md:mr-10">
            <h2 id="controls-h" data-reveal className="text-[clamp(34px,3.6vw,52px)] font-medium leading-[1.02] tracking-[-0.03em]">
              Shape how they work
            </h2>
            <Block title="Every claim cites your documents." body="Research searches the knowledge base with vector and keyword search at once, and every finding carries the passage it came from.">
              <label className="flex items-center gap-3 text-[17px]">
                <Switch checked={grounded} onChange={setGrounded} label="Use the knowledge base" /> Use the knowledge base
              </label>
            </Block>
            <Block title="The reviewer pushes back, up to a limit." body="A Reviewer can send work back to an earlier agent with specific feedback. You set how many rounds it gets, so loops always end.">
              <div className="flex items-center gap-4">
                <input aria-label="Maximum revisions" type="range" min={0} max={3} value={revisions} onChange={(e) => setRevisions(Number(e.target.value))} className="h-1 w-48 cursor-pointer accent-[var(--accent)]" />
                <span className="tabular-nums text-[17px]">
                  {revisions} {revisions === 1 ? "revision" : "revisions"}
                </span>
              </div>
            </Block>
            <Block title="Choose the team for the job." body="Draw the agents you need and connect them. Branches run in parallel; an agent with two inputs waits for both.">
              <div role="radiogroup" aria-label="Team" className="flex flex-wrap gap-5 text-[17px]">
                {(
                  [
                    ["research", "Research"],
                    ["analyst", "+ Analyst"],
                    ["full", "+ Execution"],
                  ] as [Team, string][]
                ).map(([v, l]) => (
                  <button key={v} role="radio" aria-checked={team === v} onClick={() => setTeam(v)} className={clsx("relative h-9 transition-colors", team === v ? "text-text" : "text-muted hover:text-text")}>
                    {l}
                    <span className={clsx("absolute inset-x-0 bottom-0 h-px bg-accent transition-opacity", team === v ? "opacity-100" : "opacity-0")} />
                  </button>
                ))}
              </div>
            </Block>
            <Block title="Nothing irreversible without you." body="Tools that delete or send are flagged. The run pauses at that step, keeps its state, and continues only after a person approves.">
              <label className="flex items-center gap-3 text-[17px]">
                <Switch
                  checked={canDelete}
                  onChange={(v) => {
                    setCanDelete(v);
                    if (v) setTeam("full");
                  }}
                  label="Allow the agent to propose deletions"
                />{" "}
                Allow deletions, with approval
              </label>
            </Block>
          </div>
        </div>
      </div>
    </section>
  );
}

function Cite({ n }: { n: number }) {
  return <span className="num mx-0.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[4px] bg-[var(--pill-accent-bg)] px-1 align-[1px] text-[11px] text-[var(--pill-accent-ink)]">{n}</span>;
}

function Block({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="mt-[12vh] first-of-type:mt-12 md:mt-[22vh] md:first-of-type:mt-16" data-reveal>
      <p className="text-[clamp(22px,1.95vw,28px)] font-medium leading-[1.15] tracking-[-0.02em]">{title}</p>
      <p className="mt-3 text-[17px] leading-[27px] text-[#d4d5d9]">{body}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}

/* ── 3. How it works: a run-in column with evidence under each stage ───────────── */

export function HowItWorks() {
  return (
    <section aria-labelledby="how-h" className="px-5 py-[180px] md:px-10">
      <div className="mx-auto max-w-[1440px]">
        <div className="max-w-[580px] md:ml-[28%]">
          <h2 id="how-h" data-reveal className="text-[clamp(22px,1.95vw,28px)] font-medium leading-[1.15] tracking-[-0.02em]">
            What happens when you press Run
          </h2>
          <Stage lead="To begin," body="the server checks your canvas and compiles it into a LangGraph state graph: one node per agent, joins where branches meet, and conditional edges for every reviewer. A graph that could loop forever never compiles.">
            <div data-ui className="flex items-center gap-2.5 rounded-[10px] bg-surface px-4 py-3 text-[13px]">
              <Check className="size-4 text-positive" /> Compiles to LangGraph · 4 nodes
              <span className="num ml-auto text-[12px] text-muted">research → analyst → execution → reviewer</span>
            </div>
          </Stage>
          <Stage lead="Then," body="the run and its start command are written in one database transaction. An outbox relay publishes the command to Kafka, and a worker picks it up. If anything dies between those steps, the command is still in the outbox and goes out on the next pass.">
            <EventRows
              rows={[
                ["1", "workflow.started", "nexus.lifecycle", "4 ms"],
                ["2", "agent.started · Research", "nexus.lifecycle", "6 ms"],
                ["3", "tool.called · kb_search", "nexus.lifecycle", "5 ms"],
              ]}
            />
          </Stage>
          <Stage lead="As each agent works," body="its words stream to your browser over Server-Sent Events while its finished output, tool calls and timings are stored. Close the tab mid-run and reopen it: the page replays every event since you left.">
            <div data-ui className="rounded-[10px] bg-surface px-4 py-3 text-[13px] leading-5">
              <p className="flex items-center gap-2 text-[12px] text-[var(--pill-thinking-ink)]">
                <span className="thinking-dot" /> Analysing · revision 1
              </p>
              <p className="caret mt-1.5">Leaving after month 14 would cost about €182,000; a single breach has no ceiling</p>
            </div>
          </Stage>
          <Stage lead="If a worker stops," body="nothing is lost. Every step is checkpointed in Postgres, and another worker resumes the run where it was. Finished agents are not run again, and a failed run retries from its last checkpoint.">
            <EventRows
              rows={[
                ["14", "agent.failed · Analyst", "interrupted", "—"],
                ["15", "workflow.resumed", "from checkpoint", "3 ms"],
                ["16", "agent.started · Analyst", "attempt 2", "5 ms"],
              ]}
            />
          </Stage>
          <Stage lead="When it needs you," body="it stops and asks. The approval waits without holding a worker, and you see exactly which file or channel is affected and why before anything happens.">
            <div data-ui className="flex items-center gap-3 rounded-[10px] bg-surface px-4 py-3 text-[13px]">
              <ShieldAlert className="size-4 flex-none text-warning" />
              <span className="flex-1">Delete msa-draft-2024.pdf?</span>
              <span className="rounded-full border border-control px-3 py-1 text-[12px]">Reject</span>
              <span className="rounded-full bg-[#f2f2f3] px-3 py-1 text-[12px] font-medium text-[#111114]">Approve</span>
            </div>
          </Stage>
        </div>
      </div>
    </section>
  );
}

function Stage({ lead, body, children }: { lead: string; body: string; children: React.ReactNode }) {
  return (
    <div className="mt-[72px] first-of-type:mt-12">
      <p data-reveal className="text-[17px] leading-[28px] text-[#d4d5d9]">
        <strong className="font-semibold text-text">{lead}</strong> {body}
      </p>
      <div data-reveal style={{ "--d": "90ms" } as React.CSSProperties} className="mt-5">
        {children}
      </div>
    </div>
  );
}

function EventRows({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <div data-ui className="overflow-hidden rounded-[10px] bg-surface text-[13px]">
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-rule first:border-t-0">
              <td className="num w-10 py-2.5 pl-4 text-right text-muted">{r[0]}</td>
              <td className="num py-2.5 pl-4">{r[1]}</td>
              <td className="num hidden py-2.5 text-muted sm:table-cell">{r[2]}</td>
              <td className="num py-2.5 pr-4 text-right text-muted">{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 4. The stack, as layer tabs over banded rows ──────────────────────────────── */

const LAYERS: { id: string; name: string; sub: string; rows: [string, string, string, string][] }[] = [
  {
    id: "orch",
    name: "Orchestration",
    sub: "LangGraph",
    rows: [
      ["StateGraph", "Your canvas, compiled", "Joins wait for every input; reviewers route with conditional edges", "LangGraph"],
      ["Checkpoints", "Every step saved", "Runs resume after a crash and retry without redoing work", "Postgres"],
      ["interrupt()", "Approvals pause the graph", "Nothing destructive runs until a person decides", "LangGraph"],
      ["Guards", "Loops always end", "Step timeout, 3 attempts, revision cap, token budget per run", "NEXUS"],
    ],
  },
  {
    id: "rag",
    name: "Retrieval",
    sub: "pgvector",
    rows: [
      ["HNSW index", "Semantic search", "Cosine similarity over 384-dimension embeddings", "pgvector"],
      ["Full text", "Exact terms still match", "websearch_to_tsquery over a generated tsvector column", "Postgres"],
      ["RRF, k = 60", "Both rankings fused", "Reciprocal Rank Fusion picks passages either search ranks highly", "NEXUS"],
      ["bge-small-en", "Embeddings on your machine", "Runs on CPU through ONNX; no key needed", "fastembed"],
    ],
  },
  {
    id: "events",
    name: "Events",
    sub: "Kafka",
    rows: [
      ["Outbox", "Written with the data", "Domain rows and their events commit in one transaction", "Postgres"],
      ["nexus.commands", "Work to do", "Start, resume, cancel and ingest, partitioned by run", "Kafka"],
      ["nexus.lifecycle", "What happened", "Agent and workflow events, consumed by the projector", "Kafka"],
      ["nexus.dlq", "What could not be processed", "After 3 attempts; replay from Monitoring", "Kafka"],
    ],
  },
  {
    id: "ui",
    name: "Interface",
    sub: "Next.js",
    rows: [
      ["React Flow", "The canvas", "Drag agents, connect them, follow a run on the nodes", "xyflow"],
      ["SSE", "Live without polling", "Tokens and events stream; Last-Event-ID replays a dropped connection", "FastAPI"],
      ["⌘K", "Everything a keystroke away", "Workflows, runs, uploads and workspaces from one palette", "cmdk"],
      ["OpenAPI", "Every endpoint documented", "Typed with Pydantic, browsable at /docs", "FastAPI"],
    ],
  },
];

export function Stack() {
  const [layer, setLayer] = useState(LAYERS[0].id);
  const current = LAYERS.find((l) => l.id === layer) ?? LAYERS[0];
  return (
    <section aria-labelledby="stack-h" className="px-5 py-[140px] md:px-10">
      <div className="mx-auto max-w-[1440px]">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 id="stack-h" data-reveal className="text-[clamp(34px,3.6vw,52px)] font-medium leading-[1.02] tracking-[-0.03em]">
            <span className="block text-muted">Built on parts</span>
            <span className="block">you already trust.</span>
          </h2>
          <a href="/docs" data-reveal className="inline-flex h-11 w-fit items-center gap-2 rounded-full border border-control px-5 text-[15px] transition-colors hover:border-[var(--control-hover)] hover:bg-raised">
            Read the API reference <ArrowRight className="size-4" />
          </a>
        </div>
        <div data-reveal style={{ "--d": "120ms" } as React.CSSProperties} className="mt-14 flex flex-col gap-4 md:flex-row md:gap-10">
          <div role="tablist" aria-label="Layers" className="grid grid-cols-2 gap-1.5 md:flex md:w-[150px] md:flex-none md:flex-col">
            {LAYERS.map((l) => (
              <button
                key={l.id}
                role="tab"
                aria-selected={l.id === layer}
                onClick={() => setLayer(l.id)}
                className={clsx(
                  "flex h-16 flex-col justify-center rounded-[6px] px-4 text-left transition-colors md:w-[150px]",
                  l.id === layer ? "bg-[#f2f2f3] text-[#111114]" : "bg-[#1e1d22] text-text hover:bg-[#252429]",
                )}
              >
                <span className="text-[17px] font-medium">{l.name}</span>
                <span className={clsx("text-[15px]", l.id === layer ? "text-[#4a4a50]" : "text-muted")}>{l.sub}</span>
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={current.name} className="min-w-0 flex-1">
          <ul className="flex min-w-0 flex-col gap-1">
            {current.rows.map((r, i) => (
              <li key={current.id + r[0]} style={{ animationDelay: `${i * 50}ms` }} className={clsx("rise grid grid-cols-1 gap-1 rounded-[6px] px-5 py-4 md:h-[76px] md:grid-cols-[22%_1fr_auto] md:items-center md:gap-6 md:py-0", i % 2 ? "bg-[#1b1a1f]" : "bg-[#212025]")}>
                <span className="text-[17px] font-medium tabular-nums">{r[0]}</span>
                <span className="min-w-0">
                  <span className="block text-[17px]">{r[1]}</span>
                  <span className="block text-[15px] text-muted">{r[2]}</span>
                </span>
                <span className="text-[15px] text-muted md:text-right">{r[3]}</span>
              </li>
            ))}
          </ul>
          </div>
        </div>
        <ArchiveStrip active={layer} onSelect={setLayer} />
      </div>
    </section>
  );
}

/** The older machine each layer echoes. Archival photographs, credited in the footer. */
const FIGURES: Record<string, { src: string; alt: string; caption: string; w: number; h: number; pos?: string }> = {
  orch: {
    src: "/archive/wac-telephone-switchboard-operators.jpg",
    alt: "Six switchboard operators with headsets connecting calls at a wartime telephone exchange",
    caption: "Switchboard operators, 1944. Routing each call to the right line is the job a graph does for agents.",
    w: 1920,
    h: 1476,
  },
  rag: {
    src: "/archive/inside-a-card-catalog-at-the-indiana.jpg",
    alt: "A drawer of a library card catalogue with a blue card reading: if you do not find here what you want, ask the librarian",
    caption: "A card catalogue at the Indiana State Library. Retrieval has always meant an index and a way to ask.",
    w: 1920,
    h: 1440,
  },
  events: {
    src: "/archive/photograph-of-the-pneumatic-tube-system-in.jpg",
    alt: "A curved wooden desk with a row of numbered pneumatic tube stations in the US National Archives research room",
    caption: "Pneumatic tube stations, US National Archives. Numbered lines, messages delivered in order: a message bus in brass.",
    w: 1920,
    h: 1552,
  },
};

function ArchiveStrip({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
      {Object.entries(FIGURES).map(([id, f], i) => (
        <figure key={id} data-reveal style={{ "--d": `${i * 90}ms` } as React.CSSProperties}>
          <button onClick={() => onSelect(id)} className="group block w-full overflow-hidden rounded-[6px] text-left" aria-label={`Show the ${LAYERS.find((l) => l.id === id)?.name} layer`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={f.src}
              alt={f.alt}
              width={f.w}
              height={f.h}
              loading="lazy"
              decoding="async"
              className={clsx("aspect-[4/3] w-full object-cover grayscale transition-[transform,opacity] duration-700 ease-[var(--ease)] group-hover:scale-[1.02]", active === id ? "drift opacity-100" : "opacity-70")}
            />
          </button>
          <figcaption className="relative mt-3 max-w-[48ch] pb-2 text-[15px] leading-[23px] text-muted">
            {f.caption}
            <span className={clsx("absolute bottom-0 left-0 h-px w-12 bg-accent transition-opacity", active === id ? "opacity-100" : "opacity-0")} />
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/* ── 5. The closing sentence has a blank in it ─────────────────────────────────── */

export function Closing() {
  const router = useRouter();
  const [task, setTask] = useState("");
  return (
    <section aria-labelledby="cta-h" className="px-5 py-[120px] md:px-10">
      <div className="mx-auto max-w-[1440px]">
        <h2 id="cta-h" className="sr-only">
          Start with a task
        </h2>
        <form
          data-reveal
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/register${task.trim() ? `?task=${encodeURIComponent(task.trim())}` : ""}`);
          }}
          className="max-w-[1200px] text-[clamp(30px,3.6vw,52px)] font-medium leading-[1.35] tracking-[-0.03em]"
        >
          <span>Ask your agents to </span>
          <label htmlFor="cta-task" className="sr-only">
            Task for your agents
          </label>
          <input
            id="cta-task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="brief me on our contracts"
            className="mx-1 inline-block h-[1.5em] w-full max-w-[12em] rounded-[6px] bg-[#232227] px-[0.4em] align-baseline text-text outline-none placeholder:text-muted focus:shadow-[0_0_0_2px_var(--accent)] md:w-[12em]"
          />
          <span> and watch them </span>
          <button type="submit" className="inline-flex h-[1.5em] items-center rounded-[6px] bg-accent px-[0.4em] align-baseline text-white transition-colors hover:bg-[#5f9bff] active:scale-[0.98]">
            work.
          </button>
        </form>
        <p data-reveal style={{ "--d": "90ms" } as React.CSSProperties} className="mt-8 text-[17px] text-[#d4d5d9]">
          You get a workspace with three template workflows, and your task waits in the Run dialog.
        </p>
      </div>
    </section>
  );
}

export function FooterLine() {
  return (
    <footer className="mt-[14svh] px-5 pb-[30px] md:px-10">
      <div className="mx-auto max-w-[1440px]">
      <div className="grid grid-cols-1 gap-2 text-[15px] md:grid-cols-[1fr_auto_1fr] md:items-baseline">
        <span className="text-muted">NEXUS · agentic workflows you can watch</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-6">
          <Link href="/app" className="text-text hover:text-accent-ink">
            Open the app
          </Link>
          <a href="/docs" className="text-text hover:text-accent-ink">
            API reference
          </a>
          <Link href="/login" className="text-text hover:text-accent-ink">
            Sign in
          </Link>
        </nav>
        <span className="text-muted md:text-right">© 2026 · Runs on your own infrastructure</span>
      </div>
      <p className="mt-4 max-w-[70ch] text-[13px] leading-5 text-muted">
        Photographs: “WAC telephone switchboard operators”, PhotosNormandie, CC BY-SA 2.0; “Inside a card catalog at the Indiana State Library”, CC BY-SA 4.0; “Pneumatic Tube System
        in the Control Desk of the Central Research Room”, U.S. National Archives, public domain. All via Wikimedia Commons, shown in greyscale.
      </p>
      </div>
    </footer>
  );
}
