import { clsx } from "clsx";

/**
 * The NEXUS mark: the letter N drawn as a run trace through four agent nodes.
 * The last node is lit in the accent: the step that is running now.
 */
export function Mark({ size = 22, className, live = false }: { size?: number; className?: string; live?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={clsx("flex-none", className)} aria-hidden>
      <path d="M5 19V5l14 14V5" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="5" cy="19" r="2.3" fill="currentColor" />
      <circle cx="5" cy="5" r="2.3" fill="currentColor" />
      <circle cx="19" cy="19" r="2.3" fill="currentColor" />
      <circle cx="19" cy="5" r="2.6" fill="var(--accent)" className={live ? "animate-[nexus-breathe_1.6s_infinite]" : undefined} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2 text-text", className)}>
      <Mark />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">NEXUS</span>
    </span>
  );
}
