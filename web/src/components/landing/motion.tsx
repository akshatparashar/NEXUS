"use client";

import { clsx } from "clsx";
import { useRef } from "react";
import { gsap, MOTION_OK, ScrollTrigger, useGSAP } from "@/lib/gsap";

/**
 * Entrances for the whole landing page, set up once on the page root.
 * - `[data-reveal]` parts rise in as their section enters, batched so neighbours stagger together.
 * - `[data-parallax="0.2"]` pictures drift against the scroll.
 * Everything is hidden by JavaScript only, so the page reads fine without it or with reduced motion.
 */
export function useLandingMotion() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const items = gsap.utils.toArray<HTMLElement>("[data-reveal]");
        gsap.set(items, { autoAlpha: 0, y: 28 });
        ScrollTrigger.batch(items, {
          start: "top 88%",
          once: true,
          interval: 0.08,
          onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "power3.out", overwrite: true }),
        });
        gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((el) => {
          const amount = Number(el.dataset.parallax) || 0.15;
          gsap.fromTo(
            el,
            { yPercent: -amount * 50 },
            { yPercent: amount * 50, ease: "none", scrollTrigger: { trigger: el.parentElement ?? el, start: "top bottom", end: "bottom top", scrub: 0.6 } },
          );
        });
      });
      // fonts change line lengths and therefore trigger positions
      document.fonts?.ready.then(() => ScrollTrigger.refresh());
      return () => mm.revert();
    },
    { scope: root },
  );
  return root;
}

const BLOBS = [
  { color: "var(--agent-research)", className: "left-[-8%] top-[8%] size-[46vmax]" },
  { color: "var(--agent-analyst)", className: "left-[28%] top-[-18%] size-[40vmax]" },
  { color: "var(--agent-execution)", className: "right-[-10%] top-[14%] size-[42vmax]" },
  { color: "var(--agent-reviewer)", className: "left-[38%] top-[48%] size-[34vmax]" },
];

/** The four agent hues as slow, drifting light. Decorative; hidden from assistive tech. */
export function Aurora({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.utils.toArray<HTMLElement>("span", ref.current).forEach((blob, i) => {
          gsap.to(blob, {
            x: () => gsap.utils.random(-12, 12) + "vw",
            y: () => gsap.utils.random(-10, 10) + "vh",
            scale: () => gsap.utils.random(0.85, 1.2),
            duration: gsap.utils.random(9, 14),
            ease: "sine.inOut",
            repeat: -1,
            repeatRefresh: true,
            yoyo: true,
            delay: i * -2,
          });
        });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <div ref={ref} aria-hidden className={clsx("aurora", className)} style={{ opacity: intensity }}>
      {BLOBS.map((b, i) => (
        <span key={i} className={b.className} style={{ background: `radial-gradient(circle at 50% 50%, ${b.color}, transparent 68%)` }} />
      ))}
    </div>
  );
}
