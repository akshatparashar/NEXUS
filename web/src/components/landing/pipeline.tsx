"use client";

import { Check, ShieldAlert } from "lucide-react";
import { useRef } from "react";
import { gsap, MOTION_OK, useGSAP } from "@/lib/gsap";

const STAGES: { lead: string; title: string; body: string; hue: string; ui: React.ReactNode }[] = [
  {
    lead: "To begin",
    title: "Your canvas becomes a program.",
    body: "The server checks the graph you drew and compiles it to LangGraph: one node per agent, joins where branches meet, a conditional edge for every reviewer. A graph that could loop forever never compiles.",
    hue: "var(--agent-research)",
    ui: (
      <div className="flex items-center gap-2.5 rounded-[14px] bg-black/45 px-4 py-3.5 text-[14px]">
        <Check className="size-4 flex-none text-positive" /> Compiles to LangGraph · 4 nodes
        <span className="num ml-auto hidden text-[12px] text-muted lg:inline">research → analyst → execution → reviewer</span>
      </div>
    ),
  },
  {
    lead: "Then",
    title: "Nothing gets lost on the way.",
    body: "The run and its start command are saved in one transaction. A relay hands the command to a queue and a worker picks it up. If anything stops in between, the command is still saved and goes out on the next pass.",
    hue: "var(--agent-analyst)",
    ui: (
      <EventRows
        rows={[
          ["1", "workflow.started", "4 ms"],
          ["2", "agent.started · Research", "6 ms"],
          ["3", "tool.called · kb_search", "5 ms"],
        ]}
      />
    ),
  },
  {
    lead: "As it works",
    title: "You read along, word by word.",
    body: "Each agent's words stream to your browser while its output, tool calls and timings are stored. Close the tab mid-run and come back: the page replays everything you missed.",
    hue: "var(--agent-execution)",
    ui: (
      <div className="rounded-[14px] bg-black/45 px-4 py-3.5 text-[14px] leading-6">
        <p className="flex items-center gap-2 text-[12px] text-[var(--pill-thinking-ink)]">
          <span className="thinking-dot" /> Analysing · revision 1
        </p>
        <p className="caret mt-1.5">Leaving after month 14 would cost about €182,000; a single breach has no ceiling</p>
      </div>
    ),
  },
  {
    lead: "If a worker stops",
    title: "The run picks up where it was.",
    body: "Every step is checkpointed in Postgres. Another worker resumes the run, finished agents are not run again, and a failed run retries from its last checkpoint.",
    hue: "var(--agent-reviewer)",
    ui: (
      <EventRows
        rows={[
          ["14", "agent.failed · Analyst", "interrupted"],
          ["15", "workflow.resumed", "checkpoint"],
          ["16", "agent.started · Analyst", "attempt 2"],
        ]}
      />
    ),
  },
  {
    lead: "When it needs you",
    title: "It stops and asks.",
    body: "The approval waits without holding a worker. You see exactly which file or channel is affected, and why, before anything happens.",
    hue: "var(--agent-execution)",
    ui: (
      <div className="flex items-center gap-3 rounded-[14px] bg-black/45 px-4 py-3.5 text-[14px]">
        <ShieldAlert className="size-4 flex-none text-warning" />
        <span className="min-w-0 flex-1 truncate">Delete msa-draft-2024.pdf?</span>
        <span className="rounded-full bg-white/[0.08] px-3 py-1 text-[13px]">Reject</span>
        <span className="rounded-full bg-[#f5f5f7] px-3 py-1 text-[13px] font-medium text-[#0b0b0d]">Approve</span>
      </div>
    ),
  },
];

export function Pipeline() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(`${MOTION_OK} and (min-width: 900px)`, () => {
        const el = track.current;
        if (!el) return;
        root.current?.classList.add("pipeline-pinned");
        const distance = () => el.scrollWidth - el.clientWidth;
        const slide = gsap.to(el.children, {
          x: () => -distance(),
          ease: "none", // horizontal scroll must be linear so position follows the wheel 1:1
          scrollTrigger: {
            trigger: "[data-pipeline-stage]",
            start: "top top",
            end: () => "+=" + distance(),
            pin: true,
            scrub: 0.5,
            invalidateOnRefresh: true,
          },
        });
        gsap.fromTo("[data-pipeline-progress]", { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { trigger: "[data-pipeline-stage]", start: "top top", end: () => "+=" + distance(), scrub: true } });
        // each card lifts as it reaches the middle of the screen, tied to the sideways movement
        gsap.utils.toArray<HTMLElement>("[data-stage-card]").forEach((card) => {
          gsap.fromTo(
            card,
            { scale: 0.92, autoAlpha: 0.45 },
            {
              scale: 1,
              autoAlpha: 1,
              ease: "power1.out",
              scrollTrigger: { trigger: card, containerAnimation: slide, start: "left 85%", end: "left 35%", scrub: true },
            },
          );
        });
        return () => root.current?.classList.remove("pipeline-pinned");
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="pipeline" aria-labelledby="pipeline-h" className="relative">
      <div data-pipeline-stage className="flex min-h-[100svh] flex-col justify-center overflow-hidden pb-[var(--dock-space)] pt-24 md:pt-16">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-5 md:px-10 lg:flex-row lg:items-end lg:justify-between">
          <h2 id="pipeline-h" data-reveal className="max-w-[18ch] text-[clamp(38px,4.6vw,68px)] font-semibold leading-[1] tracking-[-0.045em]">
            What happens when you press Run
          </h2>
          <p data-reveal className="max-w-[40ch] text-[17px] leading-[1.6] text-[#cfcfd6]">
            Durable, observable and event-driven. The same steps whether you run it on a laptop or in production.
          </p>
        </div>
        <div className="mx-auto mt-6 hidden h-[3px] w-full max-w-[1440px] px-10 min-[900px]:block" aria-hidden>
          <div className="h-full rounded-full bg-white/[0.08]">
            <div data-pipeline-progress className="spectrum-fill h-full origin-left rounded-full" />
          </div>
        </div>
        <div
          ref={track}
          className="pipeline-track mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-6 [scrollbar-width:none] md:gap-6 md:px-10"
          tabIndex={0}
          aria-label="Stages of a run"
        >
          {STAGES.map((s) => (
            <article
              key={s.lead}
              data-stage-card
              className="relative flex min-h-[420px] w-[86vw] flex-none snap-center flex-col overflow-hidden rounded-[28px] bg-surface p-7 min-[900px]:min-h-[min(520px,56svh)] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.06)] sm:w-[520px] md:p-9 min-[900px]:w-[560px]"
            >
              <span aria-hidden className="absolute -right-24 -top-24 size-64 rounded-full opacity-30 blur-[60px]" style={{ background: s.hue }} />
              <span aria-hidden className="block h-1 w-10 rounded-full" style={{ background: s.hue }} />
              <h3 className="mt-6 text-[clamp(24px,2.3vw,32px)] font-semibold leading-[1.1] tracking-[-0.03em]">{s.title}</h3>
              <p className="mt-4 text-[16px] leading-[1.6] text-[#cfcfd6]">
                <span className="font-medium text-text">{s.lead},</span> {s.body[0].toLowerCase() + s.body.slice(1)}
              </p>
              <div data-ui className="mt-auto pt-8">
                {s.ui}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function EventRows({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-hidden rounded-[14px] bg-black/45 text-[13px]">
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-white/[0.05] first:border-t-0">
              <td className="num w-10 py-2.5 pl-4 text-right text-muted">{r[0]}</td>
              <td className="num py-2.5 pl-4">{r[1]}</td>
              <td className="num py-2.5 pr-4 text-right text-muted">{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
