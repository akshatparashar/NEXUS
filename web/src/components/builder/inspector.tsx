"use client";

import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, ShieldAlert, Trash2, X } from "lucide-react";
import { AgentTile } from "@/components/agent-tile";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/primitives";
import { AGENTS, TOOLS } from "@/lib/agents";
import type { AgentType, NodeData } from "@/lib/types";

export interface Validation {
  valid: boolean;
  problems: string[];
  order: string[];
  revisable: Record<string, string[]>;
}

export function NodeInspector({
  id,
  type,
  data,
  onChange,
  onDelete,
  onClose,
  labels,
  revisable,
}: {
  id: string;
  type: AgentType;
  data: NodeData;
  onChange: (patch: Partial<NodeData>) => void;
  onDelete: () => void;
  onClose: () => void;
  labels: Record<string, string>;
  revisable?: string[];
}) {
  const meta = AGENTS[type];
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <AgentTile type={type} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{data.label || meta.label}</p>
          <p className="text-[12px] text-muted">
            {meta.label} agent · <span className="num">{id}</span>
          </p>
        </div>
        <button onClick={onClose} aria-label="Close inspector" className="rounded-full p-1 text-muted hover:bg-white/5 hover:text-text">
          <X className="size-4" />
        </button>
      </header>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        <p className="text-[13px] leading-5 text-muted">{meta.description}</p>
        <Field label="Name" htmlFor="node-label">
          <Input id="node-label" value={data.label ?? ""} maxLength={80} onChange={(e) => onChange({ label: e.target.value })} />
        </Field>
        <Field label="Instructions" htmlFor="node-instr" hint="Added to this agent's system prompt for every run.">
          <Textarea
            id="node-instr"
            rows={5}
            value={data.instructions ?? ""}
            maxLength={4000}
            placeholder={
              type === "research"
                ? "Focus on pricing and contract terms."
                : type === "analyst"
                  ? "Compare options and quantify trade-offs."
                  : type === "execution"
                    ? "Save a Markdown report with save_report."
                    : "Approve only if every claim is cited."
            }
            onChange={(e) => onChange({ instructions: e.target.value })}
          />
        </Field>
        <Field
          label="Temperature"
          htmlFor="node-temp"
          aside={<span className="num text-[12px] text-muted">{data.temperature == null ? "default" : data.temperature.toFixed(1)}</span>}
          hint="Lower is more precise; higher is more varied."
        >
          <div className="flex items-center gap-3">
            <input
              id="node-temp"
              type="range"
              min={0}
              max={1.2}
              step={0.1}
              value={data.temperature ?? 0.2}
              onChange={(e) => onChange({ temperature: Number(e.target.value) })}
              className="h-1 flex-1 cursor-pointer accent-[var(--accent)]"
            />
            {data.temperature != null && (
              <button className="text-[12px] text-muted hover:text-text" onClick={() => onChange({ temperature: null })}>
                Reset
              </button>
            )}
          </div>
        </Field>
        <Field label="Model override" htmlFor="node-model" hint="Leave empty to use the workspace default.">
          <Input id="node-model" value={data.model ?? ""} placeholder="e.g. gpt-4.1" onChange={(e) => onChange({ model: e.target.value || null })} />
        </Field>

        {type === "research" && (
          <Field label="Passages per query" aside={<span className="num text-[12px] text-muted">{data.topK ?? 6}</span>} hint="How many knowledge-base passages each search returns.">
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={data.topK ?? 6}
              onChange={(e) => onChange({ topK: Number(e.target.value) })}
              className="h-1 cursor-pointer accent-[var(--accent)]"
            />
          </Field>
        )}

        {type === "reviewer" && (
          <Field
            label="Max revisions"
            aside={<span className="num text-[12px] text-muted">{data.maxRevisions ?? 2}</span>}
            hint={
              revisable?.length
                ? `Can send work back to ${revisable.map((r) => labels[r] ?? r).join(", ")}. The loop stops after this many revisions.`
                : "Connect this reviewer after another agent so it can request revisions."
            }
          >
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={data.maxRevisions ?? 2}
              onChange={(e) => onChange({ maxRevisions: Number(e.target.value) })}
              className="h-1 cursor-pointer accent-[var(--accent)]"
            />
          </Field>
        )}

        {type === "execution" && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[12px] font-medium">Allowed tools</legend>
            {TOOLS.map((t) => {
              const allowed = data.tools ?? TOOLS.map((x) => x.name);
              const on = allowed.includes(t.name);
              return (
                <label key={t.name} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-[13px] hover:bg-white/[0.03]">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = on ? allowed.filter((n) => n !== t.name) : [...allowed, t.name];
                      onChange({ tools: next });
                    }}
                    className="size-3.5 accent-[var(--accent)]"
                  />
                  <span className="flex-1">{t.label}</span>
                  {t.destructive && (
                    <span className="flex items-center gap-1 text-[11px] text-[var(--pill-warning-ink)]" title="Pauses the run for approval">
                      <ShieldAlert className="size-3" /> approval
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>
        )}
      </div>
      <footer className="border-t border-white/[0.06] px-4 py-3">
        <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
          Remove agent
        </Button>
      </footer>
    </div>
  );
}

export function ValidationStrip({ validation, checking }: { validation: Validation | null; checking: boolean }) {
  if (!validation) return null;
  return (
    <div
      className={clsx("glass flex max-w-[520px] items-start gap-2.5 rounded-[10px] px-3 py-2 text-[12px]", validation.valid ? "text-muted" : "text-[var(--pill-warning-ink)]")}
      role="status"
      aria-live="polite"
    >
      {validation.valid ? <CheckCircle2 className="mt-0.5 size-3.5 flex-none text-positive" /> : <AlertTriangle className="mt-0.5 size-3.5 flex-none" />}
      <div className="min-w-0">
        {validation.valid ? (
          <span>
            Compiles to LangGraph · {validation.order.length} {validation.order.length === 1 ? "node" : "nodes"}
            {checking && " · checking…"}
          </span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {validation.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
