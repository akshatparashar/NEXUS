"use client";

import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { Mark } from "@/components/brand";
import { gsap, MOTION_OK, SplitText, useGSAP } from "@/lib/gsap";
import { HeroRun } from "./hero-run";
import { Aurora } from "./motion";

export function Hero() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
        tl.addLabel("title", 0.1);
        // each line rises from behind its own baseline; the words within it follow a beat apart
        // line one splits into words; the spectrum line rises whole so its gradient stays one piece
        SplitText.create("[data-hero-line]", {
          type: "lines,words",
          mask: "lines",
          linesClass: "split-line",
          autoSplit: true,
          onSplit(self) {
            return tl.from(self.words, { yPercent: 115, rotate: 3, duration: 1.1, stagger: 0.07 }, "title");
          },
        });
        tl.from("[data-hero-spectrum]", { yPercent: 110, duration: 1.2 }, "title+=0.22");
        tl.from("[data-hero-sub]", { y: 22, autoAlpha: 0, duration: 0.9 }, "title+=0.45")
          .from("[data-hero-cta] > *", { y: 18, autoAlpha: 0, duration: 0.8, stagger: 0.08 }, "<0.1")
          .from("[data-hero-card]", { y: 70, scale: 0.94, autoAlpha: 0, duration: 1.3, ease: "expo.out" }, "title+=0.6")
          .from("[data-hero-aurora]", { autoAlpha: 0, duration: 2, ease: "power1.out" }, 0);

        // on the way out, the run card settles back and the light dims
        gsap.to("[data-hero-card]", {
          yPercent: -6,
          scale: 0.97,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "60% top", end: "bottom top", scrub: 0.5 },
        });
        gsap.to("[data-hero-aurora]", {
          autoAlpha: 0.25,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true },
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  const watch = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.to(window, {
      scrollTo: { y: "#run", offsetY: 96, autoKill: true },
      duration: reduce ? 0 : 1.1,
      ease: "power3.inOut",
      onComplete: () => window.dispatchEvent(new Event("nexus:play-hero")),
    });
  };

  return (
    <header ref={root} id="top" className="relative isolate overflow-hidden">
      <div data-hero-aurora className="absolute inset-0 -z-10">
        <Aurora />
        {/* keeps the light behind the type soft enough to read on */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgb(9_9_11_/_0.35),rgb(9_9_11_/_0.85)_70%)]" />
        <div className="absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-b from-transparent to-ground" />
      </div>

      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 pt-5 md:px-10 md:pt-7">
        <Link href="/" aria-label="NEXUS home" className="flex items-center gap-2.5">
          <Mark size={28} live />
          <span className="text-[18px] font-semibold tracking-[-0.03em]">NEXUS</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/login" className="rounded-full px-4 py-2 text-[15px] text-[#d6d6dc] transition-colors hover:bg-white/[0.07] hover:text-white">
            Sign in
          </Link>
          <Link href="/register" className="hidden rounded-full bg-white/[0.08] px-4 py-2 text-[15px] font-medium transition-colors hover:bg-white/[0.14] sm:inline-flex">
            Create account
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-[1100px] px-5 pt-[13vh] text-center md:pt-[15vh]">
        <h1 className="text-[clamp(48px,8.4vw,128px)] font-semibold leading-[0.94] tracking-[-0.05em]">
          <span data-hero-line className="block">
            Draw a team.
          </span>
          <span className="split-line block">
            <span data-hero-spectrum className="spectrum-text block pb-[0.06em]">
              Watch it work.
            </span>
          </span>
        </h1>
        <p data-hero-sub className="mx-auto mt-8 max-w-[46ch] text-[18px] leading-[1.55] text-[#cfcfd6] md:text-[21px]">
          NEXUS runs a team of AI agents over your documents. Connect who does what, press Run, and see them research, analyse, act and review, live.
        </p>
        <div data-hero-cta className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="spectrum-ring group inline-flex h-[52px] items-center gap-2 rounded-full bg-white px-7 text-[16px] font-semibold text-[#0b0b0d] shadow-[0_10px_40px_rgb(139_133_255_/_0.35)] transition-transform duration-300 ease-[var(--ease)] hover:-translate-y-0.5 active:scale-[0.97]"
          >
            Start free
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
          <button
            onClick={watch}
            className="glass inline-flex h-[52px] items-center gap-2 rounded-full px-6 text-[16px] font-medium transition-[transform,background-color] duration-300 hover:-translate-y-0.5 hover:bg-white/[0.1] active:scale-[0.97]"
          >
            <Play className="size-4" /> Watch a run
          </button>
        </div>
        <p data-hero-cta className="mt-6 text-[14px] text-muted">
          <span>Open source · works with OpenAI, Anthropic or a free local model</span>
        </p>
      </div>

      <div id="run" className="relative mx-auto mt-[9vh] w-full max-w-[720px] px-3 pb-[16vh] sm:px-5">
        {/* the spectrum glows under the card: four agents, one run */}
        <div aria-hidden className="spectrum-fill absolute inset-x-[12%] top-[18%] -z-10 h-[60%] rounded-full opacity-40 blur-[70px]" />
        <div data-hero-card className="glass rounded-[28px]">
          <HeroRun />
        </div>
      </div>
    </header>
  );
}
