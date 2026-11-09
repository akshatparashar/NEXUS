"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Mark } from "@/components/brand";
import { HeroRun } from "@/components/landing/hero-run";
import { Closing, FooterLine, HowItWorks, LiveControls, RunBoard, Stack, useReveal } from "@/components/landing/sections";

export default function Landing() {
  const root = useReveal();
  return (
    <div ref={root} className="landing min-h-dvh overflow-x-clip bg-ground text-text">
      {/* Hero: two tones meeting at 50%. Left: what this is. Right: the product, working. */}
      <header className="relative grid min-h-[100svh] grid-cols-1 md:grid-cols-2">
        <div className="relative order-2 flex flex-col justify-end px-5 pb-10 pt-12 md:order-1 md:px-10 md:pb-10 md:pt-10">
          <Link href="/" aria-label="NEXUS home" className="absolute left-5 top-6 hidden items-center gap-2.5 md:left-10 md:top-10 md:flex">
            <Mark size={24} />
            <span className="text-[16px] font-semibold tracking-[-0.01em]">NEXUS</span>
          </Link>
          <h1 className="text-[clamp(40px,4.6vw,72px)] font-medium leading-[0.98] tracking-[-0.035em]">
            <span className="mask-line">
              <span style={{ animationDelay: "120ms" }}>Intelligence that</span>
            </span>
            <span className="mask-line">
              <span style={{ animationDelay: "230ms" }}>gets work done.</span>
            </span>
          </h1>
          <p className="fade-up mt-8 max-w-[44ch] text-[17px] leading-[27px] text-[#d4d5d9]" style={{ animationDelay: "700ms" }}>
            NEXUS runs a team of AI agents over your documents. Draw the team, give it a task, and watch it research, analyse, act and review, step by step.
          </p>
          <div className="fade-up mt-8 flex flex-wrap items-center gap-5" style={{ animationDelay: "760ms" }}>
            <Link
              href="/register"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#f2f2f3] px-5 text-[15px] font-medium text-[#111114] transition-[background-color,transform] hover:bg-white active:scale-[0.98]"
            >
              Open the app <ArrowRight className="size-4" />
            </Link>
            <span className="text-[15px] text-muted">Free to self-host. Runs with OpenAI, Anthropic or a local model.</span>
          </div>
        </div>
        <div className="relative order-1 flex min-h-[58svh] items-center justify-center bg-[#1c1b1f] px-4 pb-10 pt-20 md:order-2 md:min-h-0 md:px-10 md:py-24">
          <Link href="/" aria-label="NEXUS home" className="absolute left-5 top-6 flex items-center gap-2.5 md:hidden">
            <Mark size={22} />
            <span className="text-[15px] font-semibold">NEXUS</span>
          </Link>
          <Link href="/login" className="absolute right-5 top-6 text-[15px] text-text hover:text-accent-ink md:right-10 md:top-10">
            Sign in
          </Link>
          <div className="fade-up w-full max-w-[560px]" style={{ animationDelay: "400ms" }}>
            <HeroRun />
          </div>
        </div>
      </header>

      <main>
        <RunBoard />
        <LiveControls />
        <HowItWorks />
        <Stack />
        <Closing />
      </main>
      <FooterLine />
    </div>
  );
}
