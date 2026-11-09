"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  BookOpen,
  CornerDownLeft,
  Gauge,
  LayoutGrid,
  MessagesSquare,
  Plus,
  Settings2,
  Upload,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { StatusPill } from "@/components/ui/pill";
import { toast } from "@/components/ui/toast";
import { get, post } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { RunSummary, Workflow, WorkflowSummary } from "@/lib/types";

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const workspaces = useSession((s) => s.workspaces);
  const workspaceId = useSession((s) => s.workspaceId);
  const setWorkspace = useSession((s) => s.setWorkspace);
  const { data: workflows } = useQuery({ queryKey: ["workflows"], queryFn: () => get<WorkflowSummary[]>("/workflows"), enabled: open });
  const { data: runs } = useQuery({ queryKey: ["runs", "palette"], queryFn: () => get<RunSummary[]>("/runs?limit=8"), enabled: open });
  const mounted = useMounted();

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const newWorkflow = async () => {
    onOpenChange(false);
    try {
      const wf = await post<Workflow>("/workflows", {
        name: "Untitled workflow",
        graph: { nodes: [{ id: "research", type: "research", position: { x: 0, y: 80 }, data: { label: "Research" } }], edges: [] },
      });
      qc.invalidateQueries({ queryKey: ["workflows"] });
      router.push(`/app/workflows/${wf.id}`);
    } catch (e) {
      toast.error("Couldn't create the workflow", (e as Error).message);
    }
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[14vh]">
          <motion.div className="absolute inset-0 bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => onOpenChange(false)} />
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99, transition: { duration: 0.1 } }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="glass-strong relative w-[620px] max-w-full overflow-hidden rounded-[14px]"
          >
            <Command label="Command palette" loop className="flex flex-col" onKeyDown={(e) => e.key === "Escape" && onOpenChange(false)}>
              <Command.Input
                autoFocus
                placeholder="Search workflows, runs and commands…"
                className="h-12 w-full border-b border-white/[0.06] bg-transparent px-4 text-[14px] text-text outline-none placeholder:text-muted"
              />
              <Command.List className="max-h-[380px] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-muted">
                <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted">Nothing matches. Try a workflow name or “upload”.</Command.Empty>
                <Command.Group heading="Actions">
                  <Item icon={<Plus />} onSelect={newWorkflow} hint="New">
                    Create a workflow
                  </Item>
                  <Item icon={<Upload />} onSelect={() => go("/app/knowledge?upload=1")}>
                    Upload a document
                  </Item>
                  <Item icon={<MessagesSquare />} onSelect={() => go("/app/playground")}>
                    Talk to an agent
                  </Item>
                </Command.Group>
                <Command.Group heading="Go to">
                  <Item icon={<LayoutGrid />} onSelect={() => go("/app")}>Overview</Item>
                  <Item icon={<WorkflowIcon />} onSelect={() => go("/app/workflows")}>Workflows</Item>
                  <Item icon={<Activity />} onSelect={() => go("/app/runs")}>Runs</Item>
                  <Item icon={<BookOpen />} onSelect={() => go("/app/knowledge")}>Knowledge</Item>
                  <Item icon={<Gauge />} onSelect={() => go("/app/monitoring")}>Monitoring</Item>
                  <Item icon={<Settings2 />} onSelect={() => go("/app/settings")}>Settings</Item>
                </Command.Group>
                {!!workflows?.length && (
                  <Command.Group heading="Workflows">
                    {workflows.map((w) => (
                      <Item key={w.id} value={`workflow ${w.name}`} icon={<WorkflowIcon />} onSelect={() => go(`/app/workflows/${w.id}`)} hint={`${w.node_count} agents`}>
                        {w.name}
                      </Item>
                    ))}
                  </Command.Group>
                )}
                {!!runs?.length && (
                  <Command.Group heading="Recent runs">
                    {runs.map((r) => (
                      <Item
                        key={r.id}
                        value={`run ${r.workflow_name} ${r.input.task ?? ""}`}
                        icon={<Activity />}
                        onSelect={() => go(`/app/runs/${r.id}`)}
                        hint={<StatusPill status={r.status} />}
                      >
                        <span className="truncate">
                          {r.workflow_name} <span className="text-muted">· {fmtRelative(r.queued_at)}</span>
                        </span>
                      </Item>
                    ))}
                  </Command.Group>
                )}
                {workspaces.length > 1 && (
                  <Command.Group heading="Switch workspace">
                    {workspaces
                      .filter((w) => w.id !== workspaceId)
                      .map((w) => (
                        <Item
                          key={w.id}
                          value={`workspace ${w.name}`}
                          icon={<span className="text-[11px] font-semibold">{w.name[0]}</span>}
                          onSelect={() => {
                            setWorkspace(w.id);
                            qc.clear();
                            go("/app");
                          }}
                        >
                          {w.name}
                        </Item>
                      ))}
                  </Command.Group>
                )}
              </Command.List>
              <div className="flex h-9 items-center justify-end gap-3 border-t border-white/[0.06] px-3 text-[12px] text-muted">
                <span className="flex items-center gap-1">
                  <CornerDownLeft className="size-3" /> to select
                </span>
                <span>esc to close</span>
              </div>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Item({
  children,
  icon,
  onSelect,
  hint,
  value,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onSelect: () => void;
  hint?: React.ReactNode;
  value?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-pointer items-center gap-3 rounded-[8px] px-2.5 text-[13px] text-text data-[selected=true]:bg-white/[0.07] [&_svg]:size-4 [&_svg]:text-muted"
    >
      <span className="flex size-4 items-center justify-center">{icon}</span>
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
      {hint && <span className="flex-none text-[12px] text-muted">{hint}</span>}
    </Command.Item>
  );
}
