"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentStack } from "@/components/agent-tile";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/pill";
import { Dialog, Field, Textarea } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { ApiError, get, post } from "@/lib/api";
import type { ConfigStatus, RunSummary, WorkflowSummary } from "@/lib/types";

const EXAMPLES = [
  "Summarise the key findings in our documents and list what is still unknown.",
  "Compare the options described in the knowledge base and recommend one.",
  "Write a one-page brief on the main risks, with sources.",
];

export function RunDialog({
  open,
  onClose,
  workflowId,
  initialTask = "",
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  workflowId?: string;
  initialTask?: string;
  /** Stay where you are (the builder follows the run on its canvas) instead of opening the run page. */
  onStarted?: (run: RunSummary) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: workflows } = useQuery({ queryKey: ["workflows"], queryFn: () => get<WorkflowSummary[]>("/workflows"), enabled: open });
  const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: () => get<ConfigStatus>("/health/config"), enabled: open, staleTime: 60_000 });
  const [selected, setSelected] = useState<string | undefined>(workflowId);
  const [task, setTask] = useState(initialTask);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(workflowId);
      setTask((t) => t || initialTask);
      setError(null);
    }
  }, [open, workflowId, initialTask]);

  useEffect(() => {
    if (!selected && workflows?.length) setSelected(workflows[0].id);
  }, [workflows, selected]);

  const start = async () => {
    if (!selected || task.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const run = await post<RunSummary>(`/workflows/${selected}/runs`, { task: task.trim() });
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      onClose();
      setTask("");
      if (onStarted) onStarted(run);
      else router.push(`/app/runs/${run.id}`);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "graph_invalid") setError(((err.details?.problems as string[]) ?? []).join(" ") || err.message);
      else setError(err.message);
      if (err.code !== "graph_invalid" && err.code !== "llm_not_configured") toast.error("The run did not start", err.message);
    } finally {
      setBusy(false);
    }
  };

  const llmMissing = cfg && !cfg.llm.configured;

  return (
    <Dialog open={open} onClose={onClose} title="Start a run" description="The task goes to every agent in the workflow. You can follow each step live." width={560}>
      <div className="flex flex-col gap-5">
        {!workflowId && (
          <Field label="Workflow">
            <div className="flex max-h-[176px] flex-col gap-1 overflow-y-auto">
              {workflows?.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setSelected(w.id)}
                  className={clsx(
                    "relative flex h-11 items-center gap-3 rounded-[8px] px-3 text-left transition-colors",
                    selected === w.id ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
                  )}
                  aria-pressed={selected === w.id}
                >
                  {selected === w.id && <span className="absolute left-0 top-2.5 bottom-2.5 w-px bg-accent" />}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{w.name}</span>
                  <AgentStack types={w.agent_types} size={18} />
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Task" htmlFor="task" hint={<span>Be specific about the output you want. <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to start.</span>}>
          <Textarea
            id="task"
            autoFocus
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") start();
            }}
            placeholder="What should the agents do?"
            rows={4}
            maxLength={8000}
          />
        </Field>
        {!task && (
          <div className="-mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setTask(ex)} className="rounded-full border border-control px-3 py-1 text-[12px] text-muted transition-colors hover:border-[var(--control-hover)] hover:text-text">
                {ex.length > 46 ? `${ex.slice(0, 44)}…` : ex}
              </button>
            ))}
          </div>
        )}
        {llmMissing && (
          <p className="rounded-[6px] bg-[var(--pill-warning-bg)] px-3 py-2 text-[13px] text-[var(--pill-warning-ink)]">
            No model is configured yet. <Link href="/app/settings" className="underline underline-offset-2">Set up a provider</Link> to run agents.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-[6px] bg-[var(--pill-negative-bg)] px-3 py-2 text-[13px] text-[var(--pill-negative-ink)]">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={start} loading={busy} disabled={!selected || task.trim().length < 3} icon={<Play className="size-3.5" />}>
            Start run
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
