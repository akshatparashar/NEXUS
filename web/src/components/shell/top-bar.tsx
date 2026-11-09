"use client";

import { clsx } from "clsx";
import { Check, ChevronsUpDown, LogOut, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { create } from "zustand";
import { Mark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/pill";
import { Dialog, Input, Menu, MenuItem } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { useActivity } from "@/lib/activity";
import { useSession } from "@/lib/session";
import type { Workspace } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";

/** Pages name the object they show (a workflow, a run) so the breadcrumb can carry it. */
export const useCrumb = create<{ label: string | null; set: (l: string | null) => void }>((set) => ({
  label: null,
  set: (label) => set({ label }),
}));

const SECTION: Record<string, string> = {
  "": "Overview",
  workflows: "Workflows",
  runs: "Runs",
  playground: "Playground",
  knowledge: "Knowledge",
  monitoring: "Monitoring",
  settings: "Settings",
};

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = usePathname();
  const crumb = useCrumb((s) => s.label);
  const parts = pathname.replace(/^\/app\/?/, "").split("/").filter(Boolean);
  const section = SECTION[parts[0] ?? ""] ?? "";
  const connected = useActivity((s) => s.connected);

  return (
    <header className="sticky top-0 z-30 flex h-12 flex-none items-center gap-3 border-b border-border bg-ground/95 px-4 backdrop-blur-[2px] md:px-6">
      <Link href="/app" className="md:hidden" aria-label="NEXUS home">
        <Mark />
      </Link>
      <WorkspaceSwitcher />
      <span className="text-muted">/</span>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
        {parts.length > 1 ? (
          <>
            <Link href={`/app/${parts[0]}`} className="text-muted hover:text-text">
              {section}
            </Link>
            <span className="text-muted">/</span>
            <span className="truncate font-medium">{crumb ?? "…"}</span>
          </>
        ) : (
          <span className="font-medium">{section}</span>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onOpenPalette}
          className="hidden h-8 w-[300px] items-center gap-2 rounded-full border border-control px-3 text-[13px] text-muted transition-colors hover:border-[var(--control-hover)] hover:text-text lg:flex"
        >
          <Search className="size-3.5" aria-hidden />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd>⌘K</Kbd>
        </button>
        <button onClick={onOpenPalette} aria-label="Search" className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-raised lg:hidden">
          <Search className="size-4" />
        </button>
        <span
          className={clsx("hidden items-center gap-1.5 px-2 text-[12px] sm:flex", connected ? "text-muted" : "text-[var(--pill-warning-ink)]")}
          title={connected ? "Receiving live events" : "Reconnecting to the event stream"}
        >
          <span className={clsx("size-1.5 rounded-full", connected ? "bg-positive" : "bg-warning animate-[nexus-breathe_1.2s_infinite]")} />
          {connected ? "Live" : "Reconnecting"}
        </span>
        <UserMenu />
      </div>
    </header>
  );
}

function WorkspaceSwitcher() {
  const { workspaces, workspaceId, setWorkspace, addWorkspace } = useSession();
  const current = workspaces.find((w) => w.id === workspaceId);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();

  const switchTo = (id: string) => {
    setWorkspace(id);
    qc.clear();
    router.push("/app");
  };

  return (
    <>
      <Menu
        width={260}
        trigger={(p) => (
          <button {...p} className="flex h-8 max-w-[200px] items-center gap-2 rounded-full px-2 text-[13px] font-medium hover:bg-raised">
            <span
              className="flex size-5 flex-none items-center justify-center rounded-[5px] bg-raised text-[11px] font-semibold text-accent-ink"
              aria-hidden
            >
              {current?.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{current?.name}</span>
            <ChevronsUpDown className="size-3.5 flex-none text-muted" aria-hidden />
          </button>
        )}
      >
        {(close) => (
          <div>
            <p className="px-2 pb-1 pt-1.5 text-[12px] text-muted">Workspaces</p>
            {workspaces.map((w: Workspace) => (
              <MenuItem
                key={w.id}
                onSelect={() => {
                  close();
                  if (w.id !== workspaceId) switchTo(w.id);
                }}
                icon={w.id === workspaceId ? <Check className="size-3.5 text-accent-ink" /> : null}
              >
                {w.name}
              </MenuItem>
            ))}
            <div className="my-1 h-px bg-white/[0.06]" />
            <MenuItem
              icon={<Plus className="size-3.5" />}
              onSelect={() => {
                close();
                setCreating(true);
              }}
            >
              New workspace
            </MenuItem>
          </div>
        )}
      </Menu>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New workspace" description="Workspaces keep workflows, runs and documents apart. It starts with three template workflows.">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            try {
              const w = await post<Workspace>("/workspaces", { name });
              addWorkspace(w);
              setCreating(false);
              setName("");
              switchTo(w.id);
              toast.success(`Switched to ${w.name}`);
            } catch (err) {
              toast.error("Couldn't create the workspace", (err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="flex flex-col gap-4"
        >
          <Input autoFocus placeholder="Research team" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
              Create workspace
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function UserMenu() {
  const user = useSession((s) => s.user);
  const clear = useSession((s) => s.clear);
  const router = useRouter();
  const initials = (user?.name ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <Menu
      align="end"
      width={240}
      trigger={(p) => (
        <button {...p} aria-label="Account" className="flex size-8 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-text hover:bg-active">
          {initials}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="px-2 py-2">
            <p className="truncate text-[13px] font-medium">{user?.name}</p>
            <p className="truncate text-[12px] text-muted">{user?.email}</p>
          </div>
          <div className="my-1 h-px bg-white/[0.06]" />
          <MenuItem
            icon={<LogOut className="size-3.5" />}
            onSelect={async () => {
              close();
              try {
                await post("/auth/logout");
              } catch {
                /* already signed out */
              }
              clear();
              router.replace("/login");
            }}
          >
            Sign out
          </MenuItem>
        </div>
      )}
    </Menu>
  );
}
