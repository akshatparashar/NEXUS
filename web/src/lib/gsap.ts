"use client";

/**
 * One place that registers GSAP and its plugins, so components import from here and never
 * register twice. Every plugin ships in the public `gsap` package; none needs a licence key.
 */
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { Flip } from "gsap/Flip";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger, ScrollToPlugin, SplitText, DrawSVGPlugin, Flip);
  gsap.defaults({ ease: "power3.out", duration: 0.7 });
}

export const REDUCED = "(prefers-reduced-motion: reduce)";
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";

export { DrawSVGPlugin, Flip, gsap, ScrollToPlugin, ScrollTrigger, SplitText, useGSAP };
