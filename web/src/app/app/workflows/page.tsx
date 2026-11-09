"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MoreHorizontal, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AgentStack } from "@/components/agent-tile";
import { RunDialog } from "@/components/run-dialog";
import { Button, IconButton } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/pill";
import { Dialog, Empty, ErrorNote, Menu, MenuItem, PageHeader, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { del, get, post } from "@/lib/api";
import { fmtInt, fmtRelative } from "@/lib/format";
import type { Workflow, WorkflowSummary } from "@/lib/types";

export default function WorkflowsPage() {
  return (
    <Suspense>
      <WorkflowsInner />
    </Suspense>
  );
}

function WorkflowsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["workflows"], queryFn: () => get<WorkflowSummary[]>("/workflows") });
  const [runFor, setRunFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkflowSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const presetTask = params.get("task") ?? "";

  // arriving from the landing page with a task: open the run dialog on the first template
  useEffect(() => {
    if (presetTask && data?.length && !runFor) setRunFor(data[0].id);
  }, [presetTask, data, runFor]);

  const create = async () => {
    setBusy(true);
    try {
      const wf = await post<Workflow>("/workflows", {
        name: "Untitled workflow",
        description: "",
        graph: { nodes: [{ id: "research", type: "research", position: { x: 0, y: 80 }, data: { label: "Research" } }], edges: [] },
      });
      qc.invalidateQueries({ queryKey: ["workflows"] });
      router.push(`/app/workflows/${wf.id}`);
    } catch (e) {
      toast.error("Couldn't create the workflow", (e as Error).message);
      setBusy(false);
    }
  };

  const duplicate = async (w: WorkflowSummary) => {
    try {
      const copy = await post<Workflow>(`/workflows/${w.id}/duplicate`);
      qc.invalidateQueries({ queryKey: ["workflows"] });
      toast.success(`Duplicated as “${copy.name}”`, undefined, { label: "Open", onClick: () => router.push(`/app/workflows/${copy.id}`) });
    } catch (e) {
      toast.error("Couldn't duplicate", (e as Error).message);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    try {
      await del(`/workflows/${confirmDelete.id}`);
      qc.invalidateQueries({ queryKey: ["workflows"] });
      toast.success(`Deleted “${confirmDelete.name}”`);
    } catch (e) {
      toast.error("Couldn't delete", (e as Error).message);
    }
    setConfirmDelete(null);
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Workflows"
        sub={data ? `${data.length} ${data.length === 1 ? "workflow" : "workflows"} in this workspace. Each one is a graph of agents that compiles to LangGraph.` : " "}
        actions={
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={create} loading={busy}>
            New workflow
          </Button>
        }
      />
      {error ? (
        <ErrorNote error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[188px] w-full" />
          ))}
        </div>
      ) : data?.length === 0 ? (
        <Empty title="No workflows yet" body="Create one and drag agents onto the canvas." action={<Button size="sm" variant="primary" onClick={create}>New workflow</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((w) => (
            <article key={w.id} className="group relative flex flex-col rounded-[var(--radius-card)] bg-surface p-5 shadow-[var(--card-shadow)] transition-colors hover:bg-[#16151a]">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/app/workflows/${w.id}`} className="min-w-0 after:absolute after:inset-0">
                  <h2 className="truncate text-[16px] font-semibold leading-6">{w.name}</h2>
                </Link>
                <div className="relative z-10 -mr-2 -mt-1">
                  <Menu
                    align="end"
                    width={200}
                    trigger={(p) => (
                      <IconButton label="Workflow actions" {...p}>
                        <MoreHorizontal className="size-4" />
                      </IconButton>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => (close(), duplicate(w))}>
                          Duplicate
                        </MenuItem>
                        <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => (close(), setConfirmDelete(w))}>
                          Delete
                        </MenuItem>
                      </>
                    )}
                  </Menu>
                </div>
              </div>
              <p className="mt-1 line-clamp-2 min-h-10 text-[13px] leading-5 text-muted">{w.description || "No description."}</p>
              <div className="mt-4">
                <AgentStack types={w.agent_types} size={22} />
              </div>
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-rule pt-3">
                <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
                  {w.last_run_status ? <StatusPill status={w.last_run_status} /> : <span>Never run</span>}
                  <span className="num truncate">
                    {fmtInt(w.run_count)} {w.run_count === 1 ? "run" : "runs"}
                    {w.last_run_at ? ` · ${fmtRelative(w.last_run_at)}` : ""}
                  </span>
                </div>
                <Button size="sm" variant="secondary" className="relative z-10" icon={<Play className="size-3" />} onClick={() => setRunFor(w.id)}>
                  Run
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <RunDialog open={!!runFor} onClose={() => setRunFor(null)} workflowId={runFor ?? undefined} initialTask={presetTask} />
      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.name}”?`}
        description="The workflow and all of its runs, steps and event history are deleted. This cannot be undone."
        width={440}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={remove} icon={<Trash2 className="size-3.5" />}>
            Delete workflow
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
