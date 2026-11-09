"use client";

import { clsx } from "clsx";
import { ArrowRight, Check, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { AgentTile } from "@/components/agent-tile";
import { Mark } from "@/components/brand";
import { Flip, gsap } from "@/lib/gsap";
import type { AgentType } from "@/lib/types";
import { Aurora } from "./motion";

const H2 = "text-[clamp(38px,4.6vw,68px)] font-semibold leading-[1] tracking-[-0.045em]";

/* ── Shape how they work: real controls, one fixed output (on paper) ──────────────────────── */

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
    <section id="controls" aria-labelledby="controls-h" className="relative bg-paper text-paper-ink">
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-12 px-5 py-[140px] md:grid-cols-12 md:gap-10 md:px-10 md:py-[180px]">
        <div className="md:col-span-5">
          <h2 id="controls-h" data-reveal className={H2}>
            Shape how they work.
          </h2>
          <p data-reveal className="mt-6 max-w-[42ch] text-[18px] leading-[1.55] text-paper-muted">
            Four settings decide what your agents may do. Change them and watch the result on the right change with them.
          </p>
          <div className="mt-12 flex flex-col gap-3">
            <Control title="Cite your documents" body="Research searches the knowledge base by meaning and exact words, and every finding carries its passage.">
              <PaperSwitch checked={grounded} onChange={setGrounded} label="Use the knowledge base" />
            </Control>
            <Control title="Let the reviewer push back" body="A reviewer sends work back with specific feedback. You set how many rounds, so loops always end.">
              <div className="flex items-center gap-3">
                <input
                  aria-label="Maximum revisions"
                  type="range"
                  min={0}
                  max={3}
                  value={revisions}
                  onChange={(e) => setRevisions(Number(e.target.value))}
                  className="h-1 w-28 cursor-pointer accent-[#0b0b0d] sm:w-36"
                />
                <span className="w-24 text-[15px] tabular-nums">
                  {revisions} {revisions === 1 ? "round" : "rounds"}
                </span>
              </div>
            </Control>
            <Control title="Choose the team" body="Draw only the agents you need. Branches run in parallel; an agent with two inputs waits for both.">
              <div role="radiogroup" aria-label="Team" className="flex rounded-full bg-black/[0.06] p-1">
                {(
                  [
                    ["research", "2"],
                    ["analyst", "3"],
                    ["full", "4"],
                  ] as [Team, string][]
                ).map(([v, n]) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={team === v}
                    aria-label={`${n} agents`}
                    onClick={() => setTeam(v)}
                    className={clsx("h-8 rounded-full px-3 text-[14px] font-medium transition-colors", team === v ? "bg-white text-paper-ink shadow-[0_1px_4px_rgb(0_0_0_/_0.12)]" : "text-paper-muted hover:text-paper-ink")}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Control>
            <Control title="Nothing irreversible without you" body="Tools that delete or send are flagged. The run pauses there and continues only after a person approves.">
              <PaperSwitch
                checked={canDelete}
                onChange={(v) => {
                  setCanDelete(v);
                  if (v) setTeam("full");
                }}
                label="Allow the agent to propose deletions"
              />
            </Control>
          </div>
        </div>

        {/* the output, on a black stage lit by the team's colours */}
        <div className="md:col-span-7">
          <div data-reveal className="relative isolate flex min-h-[560px] items-center justify-center overflow-hidden rounded-[32px] bg-[#0b0b0d] p-5 md:sticky md:top-10 md:min-h-[680px] md:p-10">
            <Aurora intensity={0.55} />
            <article data-ui className="glass relative w-full max-w-[440px] rounded-[22px] p-6 text-[14px] text-text" aria-live="polite">
              <header className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[16px] font-semibold">Pricing brief</p>
                  <p className="text-[13px] text-muted">Result · {agents.length} agents</p>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-[var(--pill-positive-bg)] px-2.5 py-1 text-[12px] text-[var(--pill-positive-ink)]">
                  <Check className="size-3.5" /> Approved {score}/10
                </span>
              </header>
              <div className="mt-4 flex items-center gap-1.5">
                {agents.map((a) => (
                  <AgentTile key={a} type={a} size={24} />
                ))}
                <span className="ml-1.5 text-[13px] text-muted">{revisions === 0 ? "no revisions allowed" : `revised ${used}× of up to ${revisions}`}</span>
              </div>
              <p className="mt-5 leading-[23px]">
                {team === "research" ? (
                  <>
                    Team costs €24 per seat and Business €41{grounded ? <Cite n={1} /> : null}. Seven of twelve interviewees named SSO as the reason to upgrade{grounded ? <Cite n={3} /> : null}.
                  </>
                ) : (
                  <>
                    Add a €32 tier with SSO: 7 of 12 interviewees upgrade for SSO alone{grounded ? <Cite n={3} /> : null}, and €41 is a 71% jump from Team{grounded ? <Cite n={1} /> : null}.
                    {revisions > 0 && " The reviewer asked for the interview count behind this, so it is stated."}
                  </>
                )}
              </p>
              {!grounded && (
                <p className="mt-4 rounded-[12px] bg-[var(--pill-warning-bg)] px-3 py-2 text-[13px] text-[var(--pill-warning-ink)]">Not grounded: these figures come from the model, not your documents.</p>
              )}
              {grounded && (
                <ul className="mt-5 flex flex-col gap-1.5 border-t border-white/[0.08] pt-4">
                  <li className="num flex items-center gap-2 text-[12px] text-muted">
                    <Cite n={1} /> pricing-2026.pdf · p.2
                  </li>
                  <li className="num flex items-center gap-2 text-[12px] text-muted">
                    <Cite n={3} /> interviews-q3.md
                  </li>
                </ul>
              )}
              {team === "full" && (
                <div className="mt-5 flex items-center gap-2 rounded-[12px] bg-black/40 px-3 py-2.5 text-[13px]">
                  {canDelete ? (
                    <>
                      <ShieldAlert className="size-4 text-warning" />
                      <span className="flex-1">delete price-sheet-2025.pdf</span>
                      <span className="text-[var(--pill-warning-ink)]">waiting for you</span>
                    </>
                  ) : (
                    <>
                      <Check className="size-4 text-positive" />
                      <span className="flex-1">save_report “Pricing brief”</span>
                      <span className="text-muted">done</span>
                    </>
                  )}
                </div>
              )}
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

function Control({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div data-reveal className="flex flex-col gap-4 rounded-[22px] bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0_/_0.04)] sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h3 className="text-[18px] font-semibold tracking-[-0.02em]">{title}</h3>
        <p className="mt-1 max-w-[46ch] text-[15px] leading-[1.5] text-paper-muted">{body}</p>
      </div>
      <div className="flex-none">{children}</div>
    </div>
  );
}

function PaperSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx("relative h-[31px] w-[51px] rounded-full transition-colors duration-200", checked ? "bg-[#30c552]" : "bg-black/[0.14]")}
    >
      <span className={clsx("absolute top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0_/_0.18)] transition-[left] duration-300 ease-[var(--ease-out-strong)]", checked ? "left-[22px]" : "left-[2px]")} />
    </button>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <span className="num mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-[var(--pill-accent-bg)] px-1 align-[1px] text-[11px] text-[var(--pill-accent-ink)]">{n}</span>
  );
}

/* ── The board: runs as rows; choose one to open it ──────────────────────────────────────── */

type Status = "Succeeded" | "Running" | "Needs you" | "Failed" | "Queued";
const BOARD: { name: string; agents: number; time: string; tokens: string; status: Status; detail: string; note: string }[] = [
  { name: "Vendor due diligence", agents: 4, time: "1 m 12 s", tokens: "18,402", status: "Succeeded", detail: "Three vendors compared on 14 criteria; the reviewer approved on the first pass at 8/10.", note: "11 passages cited from 3 documents · report saved" },
  { name: "Weekly churn brief", agents: 3, time: "0 m 41 s", tokens: "9,880", status: "Running", detail: "The Analyst is writing now: churn rose in accounts without SSO, mostly in their second month.", note: "Research finished in 9.8 s · 4 queries, 18 passages" },
  { name: "Policy cleanup", agents: 4, time: "0 m 27 s", tokens: "6,215", status: "Needs you", detail: "The Execution agent wants to delete two superseded policy PDFs and is waiting for a person to approve.", note: "Nothing has been deleted · paused at a LangGraph interrupt" },
  {
    name: "Contract risk scan",
    agents: 4,
    time: "0 m 31 s",
    tokens: "14,077",
    status: "Succeeded",
    detail: "The reviewer sent the analysis back once: “quantify the exit penalty”. Revision 1 was approved at 9/10.",
    note: "6 passages cited from msa-2026.pdf · report saved · 1 deletion approved by a person",
  },
  { name: "Board pack summary", agents: 3, time: "2 m 03 s", tokens: "22,610", status: "Failed", detail: "The Analyst timed out after 3 attempts while the model provider was rate-limiting.", note: "Retry continues from the last checkpoint; Research is not redone" },
  { name: "Competitor pricing", agents: 4, time: "—", tokens: "—", status: "Queued", detail: "Waiting for a worker slot. It starts when one of the four concurrent runs finishes.", note: "The start command is saved and queued" },
];

const statusChip: Record<Status, string> = {
  Succeeded: "bg-[var(--pill-positive-bg)] text-[var(--pill-positive-ink)]",
  Running: "bg-[var(--pill-thinking-bg)] text-[var(--pill-thinking-ink)]",
  "Needs you": "bg-[var(--pill-warning-bg)] text-[var(--pill-warning-ink)]",
  Failed: "bg-[var(--pill-negative-bg)] text-[var(--pill-negative-ink)]",
  Queued: "bg-white/[0.08] text-[#c9c9cf]",
};

export function RunBoard() {
  const [open, setOpen] = useState(3);
  return (
    <section id="board" aria-labelledby="board-h" className="relative py-[140px] md:py-[180px]">
      <div className="mx-auto max-w-[1440px] px-5 md:px-10">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:items-end">
          <h2 id="board-h" data-reveal className={clsx(H2, "md:col-span-7")}>
            Every run, on one board.
          </h2>
          <p data-reveal className="max-w-[44ch] text-[17px] leading-[1.6] text-[#cfcfd6] md:col-span-5">
            Rows update the moment an agent starts, calls a tool, asks for a revision or waits for you. Choose one to see what happened inside.
          </p>
        </div>
        <ul data-ui className="mt-14 flex flex-col gap-2" role="list">
          {BOARD.map((r, i) => {
            const isOpen = i === open;
            return (
              <li key={r.name} data-reveal>
                <button
                  onClick={() => setOpen(i)}
                  aria-expanded={isOpen}
                  className={clsx(
                    "grid w-full grid-cols-[1fr_auto] items-start gap-4 rounded-[22px] px-5 text-left transition-[background-color,color,padding] duration-500 ease-[var(--ease-out-strong)] md:grid-cols-12 md:px-7",
                    isOpen ? "bg-paper py-7 text-paper-ink" : "bg-surface py-5 hover:bg-raised",
                  )}
                >
                  <span className="min-w-0 md:col-span-6">
                    <span className="block truncate text-[clamp(19px,1.8vw,26px)] font-semibold tracking-[-0.025em]">{r.name}</span>
                    <span className={clsx("grid transition-[grid-template-rows,opacity] duration-500 ease-[var(--ease-out-strong)]", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                      <span className="overflow-hidden">
                        <span className="mt-3 block max-w-[56ch] text-[16px] leading-[1.55]">{r.detail}</span>
                        <span className={clsx("mt-2 block text-[14px]", isOpen ? "text-paper-muted" : "text-muted")}>{r.note}</span>
                      </span>
                    </span>
                  </span>
                  <span className={clsx("hidden pt-1 text-[16px] tabular-nums md:col-span-2 md:block", isOpen ? "text-paper-muted" : "text-muted")}>{r.agents} agents</span>
                  <span className={clsx("hidden pt-1 text-[16px] tabular-nums md:col-span-2 md:block", isOpen ? "text-paper-muted" : "text-muted")}>{r.time}</span>
                  <span className="justify-self-end pt-0.5 md:col-span-2">
                    <span className={clsx("inline-flex h-8 items-center whitespace-nowrap rounded-full px-3.5 text-[14px] font-medium", isOpen ? "bg-[#0b0b0d] text-white" : statusChip[r.status])}>{r.status}</span>
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

/* ── The stack: layer tabs with a Flip highlight, archival pictures in greyscale ─────────── */

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
      ["HNSW index", "Search by meaning", "Cosine similarity over 384-dimension embeddings", "pgvector"],
      ["Full text", "Exact terms still match", "websearch_to_tsquery over a generated tsvector column", "Postgres"],
      ["RRF, k = 60", "Both rankings fused", "Reciprocal Rank Fusion picks passages either search ranks highly", "NEXUS"],
      ["bge-small-en", "Embeddings on your machine", "Runs on CPU through ONNX; no key needed", "fastembed"],
    ],
  },
  {
    id: "events",
    name: "Events",
    sub: "Outbox + queue",
    rows: [
      ["Outbox", "Written with the data", "Domain rows and their events commit in one transaction", "Postgres"],
      ["Commands", "Work to do", "Start, resume, cancel and ingest, keyed by run", "Kafka or Vercel Queues"],
      ["Lifecycle", "What happened", "Agent and workflow events, projected into the run views", "Projector"],
      ["Dead letters", "What could not be processed", "After 3 attempts; replay from Monitoring", "NEXUS"],
    ],
  },
  {
    id: "ui",
    name: "Interface",
    sub: "Next.js",
    rows: [
      ["React Flow", "The canvas", "Drag agents, connect them, follow a run on the nodes", "xyflow"],
      ["SSE", "Live without polling", "Tokens and events stream; a dropped connection replays what it missed", "FastAPI"],
      ["⌘K", "Everything a keystroke away", "Workflows, runs, uploads and workspaces from one palette", "cmdk"],
      ["OpenAPI", "Every endpoint documented", "Typed with Pydantic, browsable at /docs", "FastAPI"],
    ],
  },
];

const FIGURES: Record<string, { src: string; alt: string; caption: string; w: number; h: number }> = {
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

export function Stack() {
  const [layer, setLayer] = useState(LAYERS[0].id);
  const current = LAYERS.find((l) => l.id === layer) ?? LAYERS[0];
  const tabs = useRef<HTMLDivElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const rows = useRef<HTMLUListElement>(null);

  const choose = (id: string) => {
    if (id === layer) return;
    // Flip: remember where the highlight is, move it in the DOM, then animate from there
    flipState.current = Flip.getState(tabs.current?.querySelector("[data-tab-highlight]") ?? []);
    setLayer(id);
  };

  useLayoutEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (flipState.current && !reduce) {
      Flip.from(flipState.current, {
        targets: tabs.current?.querySelectorAll("[data-tab-highlight]"),
        duration: 0.55,
        ease: "power3.inOut",
        absolute: true,
      });
      gsap.from(rows.current?.children ?? [], { y: 14, autoAlpha: 0, duration: 0.45, stagger: 0.05, ease: "power2.out" });
    }
    flipState.current = null;
  }, [layer]);

  return (
    <section id="stack" aria-labelledby="stack-h" className="bg-paper pb-[140px] pt-[112px] text-paper-ink md:pb-[180px] md:pt-[128px]">
      <div className="mx-auto max-w-[1440px] px-5 md:px-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 id="stack-h" data-reveal className={H2}>
            <span className="block text-paper-muted">Built on parts</span>
            <span className="block">you already trust.</span>
          </h2>
          <a
            href="/docs"
            data-reveal
            className="inline-flex h-12 w-fit items-center gap-2 rounded-full bg-[#0b0b0d] px-6 text-[15px] font-medium text-white transition-transform duration-300 hover:-translate-y-0.5 active:scale-[0.97]"
          >
            Read the API reference <ArrowRight className="size-4" />
          </a>
        </div>
        <div data-reveal className="mt-14 flex flex-col gap-4 md:flex-row md:gap-10">
          <div ref={tabs} role="tablist" aria-label="Layers" className="grid grid-cols-2 gap-1.5 md:flex md:w-[190px] md:flex-none md:flex-col">
            {LAYERS.map((l) => (
              <button
                key={l.id}
                role="tab"
                aria-selected={l.id === layer}
                onClick={() => choose(l.id)}
                className={clsx("relative flex h-[68px] flex-col justify-center rounded-[18px] px-5 text-left transition-colors", l.id === layer ? "text-white" : "text-paper-ink hover:bg-black/[0.05]")}
              >
                {l.id === layer && <span data-tab-highlight data-flip-id="tab" className="absolute inset-0 -z-0 rounded-[18px] bg-[#0b0b0d]" />}
                <span className="relative text-[17px] font-semibold">{l.name}</span>
                <span className={clsx("relative text-[14px]", l.id === layer ? "text-white/65" : "text-paper-muted")}>{l.sub}</span>
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={current.name} className="min-w-0 flex-1">
            <ul ref={rows} className="flex min-w-0 flex-col gap-1.5">
              {current.rows.map((r) => (
                <li key={current.id + r[0]} className="grid grid-cols-1 gap-1 rounded-[18px] bg-white px-6 py-4 md:h-[78px] md:grid-cols-[22%_1fr_auto] md:items-center md:gap-6 md:py-0">
                  <span className="text-[17px] font-semibold tabular-nums">{r[0]}</span>
                  <span className="min-w-0">
                    <span className="block text-[16px] font-medium">{r[1]}</span>
                    <span className="block text-[14px] text-paper-muted">{r[2]}</span>
                  </span>
                  <span className="text-[14px] text-paper-muted md:text-right">{r[3]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {Object.entries(FIGURES).map(([id, f]) => (
            <figure key={id} data-reveal>
              <button onClick={() => choose(id)} className="group block w-full overflow-hidden rounded-[22px] text-left" aria-label={`Show the ${LAYERS.find((l) => l.id === id)?.name} layer`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.src}
                  alt={f.alt}
                  width={f.w}
                  height={f.h}
                  loading="lazy"
                  decoding="async"
                  className={clsx("aspect-[4/3] w-full object-cover grayscale transition-[transform,opacity] duration-700 ease-[var(--ease)] group-hover:scale-[1.03]", layer === id ? "drift opacity-100" : "opacity-75")}
                />
              </button>
              <figcaption className="mt-3 max-w-[48ch] text-[15px] leading-[1.5] text-paper-muted">{f.caption}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Closing: the sentence has a blank in it ─────────────────────────────────────────────── */

export function Closing() {
  const router = useRouter();
  const [task, setTask] = useState("");
  return (
    <section id="start" aria-labelledby="cta-h" className="relative isolate overflow-hidden px-5 pb-[60px] pt-[160px] md:px-10 md:pt-[200px]">
      <Aurora className="-z-10" intensity={0.7} />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_40%,rgb(9_9_11_/_0.3),rgb(9_9_11_/_0.9)_70%)]" />
      <div className="mx-auto max-w-[1200px] text-center">
        <h2 id="cta-h" data-reveal className={H2}>
          Give your team a task.
        </h2>
        <form
          data-reveal
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/register${task.trim() ? `?task=${encodeURIComponent(task.trim())}` : ""}`);
          }}
          className="glass mx-auto mt-12 flex max-w-[680px] flex-col gap-2 rounded-[28px] p-2 sm:flex-row sm:items-center sm:rounded-full"
        >
          <label htmlFor="cta-task" className="sr-only">
            Task for your agents
          </label>
          <input
            id="cta-task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Brief me on our supplier contracts"
            className="h-14 min-w-0 flex-1 rounded-full bg-transparent px-5 text-[17px] text-text outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            className="spectrum-fill inline-flex h-14 items-center justify-center gap-2 rounded-full px-7 text-[16px] font-semibold text-[#0b0b0d] transition-[transform,filter] duration-300 hover:brightness-110 active:scale-[0.97]"
          >
            Run it <ArrowRight className="size-4" />
          </button>
        </form>
        <p data-reveal className="mt-6 text-[16px] text-[#cfcfd6]">
          You get a workspace with three ready workflows, and your task waits in the Run dialog.
        </p>
      </div>
      <Footer />
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto mt-[160px] max-w-[1440px] pb-[var(--dock-space)]">
      <p aria-hidden className="spectrum-text select-none text-center text-[clamp(84px,21vw,330px)] font-semibold leading-[0.8] tracking-[-0.07em]">
        NEXUS
      </p>
      <div className="mt-12 grid grid-cols-1 gap-4 text-[15px] md:grid-cols-[1fr_auto_1fr] md:items-baseline">
        <span className="flex items-center gap-2 text-muted">
          <Mark size={18} /> Agentic workflows you can watch
        </span>
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
      <p className="mt-5 max-w-[70ch] text-[13px] leading-5 text-muted">
        Photographs: “WAC telephone switchboard operators”, PhotosNormandie, CC BY-SA 2.0; “Inside a card catalog at the Indiana State Library”, CC BY-SA 4.0; “Pneumatic Tube System in the
        Control Desk of the Central Research Room”, U.S. National Archives, public domain. All via Wikimedia Commons, shown in greyscale.
      </p>
    </footer>
  );
}
