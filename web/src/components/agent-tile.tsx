import { clsx } from "clsx";
import { AGENTS } from "@/lib/agents";
import type { AgentType } from "@/lib/types";

/** Node-type tile: the agent's identity tint at low strength behind its icon. Builder convention only. */
export function AgentTile({ type, size = 24, className }: { type: AgentType; size?: number; className?: string }) {
  const meta = AGENTS[type];
  const Icon = meta.icon;
  return (
    <span
      className={clsx("inline-flex flex-none items-center justify-center rounded-[6px]", className)}
      style={{
        width: size,
        height: size,
        color: meta.hue,
        background: `color-mix(in oklab, ${meta.hue} 14%, transparent)`,
      }}
      aria-hidden
    >
      <Icon style={{ width: size * 0.58, height: size * 0.58 }} strokeWidth={1.7} />
    </span>
  );
}

export function AgentStack({ types, size = 20 }: { types: AgentType[]; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={types.map((t) => AGENTS[t]?.label).join(", ")}>
      {types.map((t, i) => (AGENTS[t] ? <AgentTile key={i} type={t} size={size} /> : null))}
    </span>
  );
}
