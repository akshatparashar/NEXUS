import { clsx } from "clsx";

/**
 * The NEXUS mark: the letter N drawn as a run passing through four agents. Each node wears its
 * agent's colour (Research, Analyst, Execution, Reviewer) and the stroke blends between them.
 * `live` makes the last node breathe: the step that is running now.
 */
export function Mark({ size = 22, className, live = false, mono = false }: { size?: number; className?: string; live?: boolean; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={clsx("flex-none", className)} aria-hidden>
      <defs>
        <linearGradient id="nexus-mark-stroke" x1="5" y1="19" x2="19" y2="5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--agent-research)" />
          <stop offset="0.4" stopColor="var(--agent-analyst)" />
          <stop offset="0.7" stopColor="var(--agent-execution)" />
          <stop offset="1" stopColor="var(--agent-reviewer)" />
        </linearGradient>
      </defs>
      <path
        d="M5 19V5l14 14V5"
        stroke={mono ? "currentColor" : "url(#nexus-mark-stroke)"}
        strokeOpacity={mono ? 0.55 : 0.9}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="19" r="2.4" fill={mono ? "currentColor" : "var(--agent-research)"} />
      <circle cx="5" cy="5" r="2.4" fill={mono ? "currentColor" : "var(--agent-analyst)"} />
      <circle cx="19" cy="19" r="2.4" fill={mono ? "currentColor" : "var(--agent-execution)"} />
      <circle cx="19" cy="5" r="2.7" fill="var(--agent-reviewer)" className={live ? "animate-[nexus-breathe_1.6s_infinite]" : undefined} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2 text-text", className)}>
      <Mark />
      <span className="text-[15px] font-semibold tracking-[-0.02em]">NEXUS</span>
    </span>
  );
}
