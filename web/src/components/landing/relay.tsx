"use client";

import { clsx } from "clsx";
import { Check, Search, ShieldAlert, Sparkles } from "lucide-react";
import { useRef } from "react";
import { AgentTile } from "@/components/agent-tile";
import { gsap, MOTION_OK, ScrollTrigger, useGSAP } from "@/lib/gsap";
import type { AgentType } from "@/lib/types";

/* The N of the logo, drawn large: Research (bottom left) → Analyst (top left) → Execution
   (bottom right) → Reviewer (top right). A run is literally the mark being drawn. */
const POINTS: Record<AgentType, [number, number]> = {
  research: [90, 470],
  analyst: [90, 90],
  execution: [470, 470],
  reviewer: [470, 90],
};
const ORDER: AgentType[] = ["research", "analyst", "execution", "reviewer"];
const SEGMENTS = ["M90 470 L90 90", "M90 90 L470 470", "M470 470 L470 90"];

const STEPS: { type: AgentType; title: string; body: string; proof: React.ReactNode }[] = [
  {
    type: "research",
    title: "Research reads first.",
    body: "It searches your documents by meaning and by exact words at once, and brings back each passage with the file and page it came from.",
    proof: (
      <>
        <Search className="size-4 flex-none text-research" />
        <span className="truncate">kb_search “termination penalty”</span>
        <span className="ml-auto flex-none text-muted">5 passages</span>
      </>
    ),
  },
  {
    type: "analyst",
    title: "Analyst finds what matters.",
    body: "It weighs the findings, spots the gaps and puts numbers on them, citing the passages it relied on.",
    proof: (
      <>
        <Sparkles className="size-4 flex-none text-analyst" />
        <span className="truncate">Leaving after month 14 costs about €182,000</span>
      </>
    ),
  },
  {
    type: "execution",
    title: "Execution acts, with your OK.",
    body: "It saves reports, posts to your webhooks and tidies files. Anything that cannot be undone waits for a person to approve.",
    proof: (
      <>
        <ShieldAlert className="size-4 flex-none text-execution" />
        <span className="truncate">delete msa-draft-2024.pdf</span>
        <span className="ml-auto flex-none text-[var(--pill-warning-ink)]">waiting for you</span>
      </>
    ),
  },
  {
    type: "reviewer",
    title: "Reviewer sends weak work back.",
    body: "It scores the result and returns it with specific feedback, as many rounds as you allow. Loops always end.",
    proof: (
      <>
        <Check className="size-4 flex-none text-reviewer" />
        <span className="truncate">Approved 9/10 after one revision</span>
      </>
    ),
  },
];

export function Relay() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      // desktop: pin the stage and scrub the drawing through four beats
      mm.add(`${MOTION_OK} and (min-width: 900px)`, () => {
        const steps = gsap.utils.toArray<HTMLElement>("[data-step]");
        const nodes = gsap.utils.toArray<SVGGElement>("[data-node]");
        const segs = gsap.utils.toArray<SVGPathElement>("[data-seg]");
        const glows = gsap.utils.toArray<HTMLElement>("[data-glow]");

        gsap.set(steps.slice(1), { autoAlpha: 0, y: 40 });
        gsap.set(segs, { drawSVG: "0%" });
        nodes.forEach((n) => gsap.set(n, { scale: 0.6, autoAlpha: 0.35, svgOrigin: n.dataset.origin }));
        gsap.set(glows.slice(1), { autoAlpha: 0 });
        gsap.set("[data-loop]", { drawSVG: "0%" });
        gsap.set("[data-loop-label]", { autoAlpha: 0 });
        root.current?.classList.add("relay-pinned");

        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: "[data-relay-stage]",
            start: "top top",
            end: "+=320%",
            pin: true,
            scrub: 0.6,
            snap: { snapTo: "labels", duration: { min: 0.2, max: 0.6 }, ease: "power2.inOut" },
          },
        });
        tl.addLabel("research").to(nodes[0], { scale: 1, autoAlpha: 1, duration: 0.3, ease: "back.out(2)" });
        ORDER.slice(1).forEach((_, i) => {
          tl.to(segs[i], { drawSVG: "100%", duration: 1 })
            .to(steps[i], { autoAlpha: 0, y: -40, duration: 0.3 }, "<0.2")
            .to(glows[i], { autoAlpha: 0, duration: 0.6 }, "<")
            .to(glows[i + 1], { autoAlpha: 1, duration: 0.6 }, "<")
            .addLabel(ORDER[i + 1])
            .to(nodes[i + 1], { scale: 1, autoAlpha: 1, duration: 0.3, ease: "back.out(2)" }, "-=0.25")
            .to(steps[i + 1], { autoAlpha: 1, y: 0, duration: 0.35 }, "<");
        });
        tl.to("[data-loop]", { drawSVG: "100%", duration: 0.8 }).to("[data-loop-label]", { autoAlpha: 1, duration: 0.2 }, "<0.5");
        return () => {
          root.current?.classList.remove("relay-pinned");
          ScrollTrigger.refresh();
        };
      });
      // phones and reduced motion: everything is shown, the line draws once as it enters
      mm.add(`${MOTION_OK} and (max-width: 899px)`, () => {
        gsap.from("[data-seg], [data-loop]", {
          drawSVG: "0%",
          duration: 1.4,
          stagger: 0.35,
          ease: "power2.inOut",
          scrollTrigger: { trigger: "[data-relay-graph]", start: "top 75%" },
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="relay" aria-labelledby="relay-h" className="relative">
      <div data-relay-stage className="relative flex min-h-[100svh] items-center overflow-hidden py-24 md:py-0">
        {/* each agent's light, cross-fading as the work passes on */}
        {ORDER.map((t, i) => (
          <div
            key={t}
            data-glow
            aria-hidden
            className={clsx("pointer-events-none absolute inset-0 -z-10", i > 0 && "max-[899px]:hidden")}
            style={{ background: `radial-gradient(ellipse 60% 55% at 70% 50%, color-mix(in oklab, var(--agent-${t}) 26%, transparent), transparent 70%)` }}
          />
        ))}
        <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-12 px-5 md:px-10 min-[900px]:grid-cols-[1fr_1.05fr]">
          <div className="relative">
            <h2 id="relay-h" className="text-[clamp(38px,4.6vw,68px)] font-semibold leading-[1] tracking-[-0.045em]">
              Four agents.
              <br />
              One relay.
            </h2>
            <p className="mt-6 max-w-[44ch] text-[18px] leading-[1.55] text-[#cfcfd6]">
              Every workflow is a hand-off. Each agent owns a colour, so you can follow the work as it moves.
            </p>
            {/* desktop: the steps stack in one place and take turns; phone: a plain list */}
            <div className="relay-steps relative mt-12">
              {STEPS.map((s) => (
                <article key={s.type} data-step className="mb-10 last:mb-0">
                  <div className="flex items-center gap-3">
                    <AgentTile type={s.type} size={36} className="rounded-[10px]" />
                    <h3 className="text-[clamp(24px,2.2vw,32px)] font-semibold leading-tight tracking-[-0.03em]">{s.title}</h3>
                  </div>
                  <p className="mt-4 max-w-[46ch] text-[17px] leading-[1.6] text-[#cfcfd6]">{s.body}</p>
                  <div data-ui className="glass mt-6 flex max-w-[460px] items-center gap-3 rounded-[16px] px-4 py-3.5 text-[14px]">
                    {s.proof}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div data-relay-graph className="relative mx-auto w-full max-w-[560px]" aria-hidden>
            <svg viewBox="0 0 560 560" className="w-full overflow-visible">
              <defs>
                <linearGradient id="relay-grad" x1="90" y1="470" x2="470" y2="90" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="var(--agent-research)" />
                  <stop offset="0.38" stopColor="var(--agent-analyst)" />
                  <stop offset="0.68" stopColor="var(--agent-execution)" />
                  <stop offset="1" stopColor="var(--agent-reviewer)" />
                </linearGradient>
              </defs>
              {/* the track, then the run drawn over it */}
              <path d="M90 470 L90 90 L470 470 L470 90" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
              {SEGMENTS.map((d) => (
                <path key={d} data-seg d={d} fill="none" stroke="url(#relay-grad)" strokeWidth="14" strokeLinecap="round" />
              ))}
              {/* the reviewer's loop back to the analyst */}
              <path data-loop d="M470 90 C 400 -10, 160 -10, 90 90" fill="none" stroke="var(--agent-reviewer)" strokeWidth="3" strokeDasharray="2 10" strokeLinecap="round" />
              <text data-loop-label x="280" y="18" textAnchor="middle" className="fill-[#cfcfd6] text-[15px]" style={{ fontFamily: "var(--font-sans)" }}>
                revise, up to 2 times
              </text>
              {ORDER.map((t) => {
                const [x, y] = POINTS[t];
                return (
                  <g key={t} data-node data-origin={`${x} ${y}`}>
                    <circle cx={x} cy={y} r="46" fill={`color-mix(in oklab, var(--agent-${t}) 18%, transparent)`} />
                    <circle cx={x} cy={y} r="30" fill={`var(--agent-${t})`} />
                    <text x={x} y={y + (y > 300 ? 78 : -62)} textAnchor="middle" className="fill-white text-[19px] font-semibold" style={{ fontFamily: "var(--font-sans)" }}>
                      {t[0].toUpperCase() + t.slice(1)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
