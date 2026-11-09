"use client";

import { ArrowRight, Boxes, Home, Layers, LayoutList, SlidersHorizontal, Workflow } from "lucide-react";
import { useState } from "react";
import { Dock, type DockItem } from "@/components/dock/dock";
import { Hero } from "@/components/landing/hero";
import { useLandingMotion } from "@/components/landing/motion";
import { Pipeline } from "@/components/landing/pipeline";
import { Relay } from "@/components/landing/relay";
import { Closing, LiveControls, RunBoard, Stack } from "@/components/landing/sections";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/gsap";

const SECTIONS = [
  { id: "top", label: "Home", icon: Home },
  { id: "relay", label: "Agents", icon: Boxes },
  { id: "controls", label: "Controls", icon: SlidersHorizontal },
  { id: "board", label: "Runs", icon: LayoutList },
  { id: "pipeline", label: "Pipeline", icon: Workflow },
  { id: "stack", label: "Stack", icon: Layers },
];

export default function Landing() {
  const root = useLandingMotion();
  const [active, setActive] = useState("top");

  // the dock follows the section in the middle of the screen
  useGSAP(
    () => {
      SECTIONS.forEach((s) => {
        ScrollTrigger.create({
          trigger: `#${s.id}`,
          start: "top 55%",
          end: "bottom 55%",
          onToggle: (self) => self.isActive && setActive(s.id),
        });
      });
    },
    { scope: root },
  );

  const go = (id: string) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.to(window, { scrollTo: { y: `#${id}`, autoKill: true }, duration: reduce ? 0 : 1.1, ease: "power3.inOut" });
  };

  const items: DockItem[] = SECTIONS.map((s) => ({ id: s.id, label: s.label, icon: s.icon, onSelect: () => go(s.id) }));

  return (
    <div ref={root} className="landing min-h-dvh overflow-x-clip bg-ground text-text">
      <Hero />
      <main>
        <Relay />
        <LiveControls />
        <RunBoard />
        <Pipeline />
        <Stack />
        <Closing />
      </main>
      <Dock label="Page sections" items={items} activeId={active} action={{ label: "Open the app", href: "/register", icon: ArrowRight }} />
    </div>
  );
}
