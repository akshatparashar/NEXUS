import { clsx } from "clsx";
import { STATUS_LABEL } from "@/lib/agents";
import type { RunStatus } from "@/lib/types";

type Tone = "positive" | "negative" | "warning" | "neutral" | "thinking" | "accent";

const tones: Record<Tone, string> = {
  positive: "bg-[var(--pill-positive-bg)] text-[var(--pill-positive-ink)]",
  negative: "bg-[var(--pill-negative-bg)] text-[var(--pill-negative-ink)]",
  warning: "bg-[var(--pill-warning-bg)] text-[var(--pill-warning-ink)]",
  neutral: "bg-[var(--pill-neutral-bg)] text-[var(--pill-neutral-ink)]",
  thinking: "bg-[var(--pill-thinking-bg)] text-[var(--pill-thinking-ink)]",
  accent: "bg-[var(--pill-accent-bg)] text-[var(--pill-accent-ink)]",
};

export function Pill({ tone = "neutral", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex h-5 flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-medium leading-none",
        tones[tone],
        className,
      )}
    >
      {dot && <span className={clsx("size-1.5 rounded-full bg-current", tone === "thinking" && "animate-[nexus-breathe_1.4s_infinite]")} />}
      {children}
    </span>
  );
}

const statusTone: Record<RunStatus, Tone> = {
  queued: "neutral",
  running: "thinking",
  awaiting_approval: "warning",
  succeeded: "positive",
  failed: "negative",
  cancelled: "neutral",
  timed_out: "negative",
};

export function StatusPill({ status, className }: { status: RunStatus; className?: string }) {
  return (
    <Pill tone={statusTone[status]} dot={status === "running" || status === "queued"} className={className}>
      {STATUS_LABEL[status]}
    </Pill>
  );
}

export function StepStatusPill({ status }: { status: string }) {
  const map: Record<string, [Tone, string]> = {
    running: ["thinking", "Working"],
    succeeded: ["positive", "Done"],
    failed: ["negative", "Failed"],
    awaiting_approval: ["warning", "Waiting for you"],
    cancelled: ["neutral", "Cancelled"],
  };
  const [tone, label] = map[status] ?? ["neutral", status];
  return (
    <Pill tone={tone} dot={status === "running"}>
      {label}
    </Pill>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={clsx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-control px-1 font-sans text-[11px] leading-none text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
