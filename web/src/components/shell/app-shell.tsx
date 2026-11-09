"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, BookOpen, Gauge, LayoutGrid, MessagesSquare, Search, Settings2, Workflow as WorkflowIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Mark } from "@/components/brand";
import { Dock, type DockItem } from "@/components/dock/dock";
import { get, refreshSession } from "@/lib/api";
import { useActivityStream } from "@/lib/activity";
import { useSession } from "@/lib/session";
import type { Approval, ConfigStatus } from "@/lib/types";
import { CommandPalette, useCommandPalette } from "./command-palette";
import { TopBar } from "./top-bar";

const NAV = [
  { id: "overview", href: "/app", label: "Overview", icon: LayoutGrid, exact: true },
  { id: "workflows", href: "/app/workflows", label: "Workflows", icon: WorkflowIcon },
  { id: "runs", href: "/app/runs", label: "Runs", icon: Activity },
  { id: "playground", href: "/app/playground", label: "Playground", icon: MessagesSquare },
  { id: "knowledge", href: "/app/knowledge", label: "Knowledge", icon: BookOpen },
  { id: "monitoring", href: "/app/monitoring", label: "Monitoring", icon: Gauge },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();
  const palette = useCommandPalette();

  // restore the session from the refresh cookie
  useEffect(() => {
    if (status === "loading") {
      refreshSession().then((ok) => {
        if (!ok) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      });
    } else if (status === "anon") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  useActivityStream();

  if (status !== "authed") return <BootScreen />;

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar onOpenPalette={() => palette.setOpen(true)} />
      <main className="min-w-0 flex-1 pb-[var(--dock-space)]">{children}</main>
      <AppDock onOpenPalette={() => palette.setOpen(true)} />
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </div>
  );
}

function BootScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex items-center gap-3 text-muted">
        <Mark live />
        <span className="text-[13px]">Opening your workspace…</span>
      </div>
    </div>
  );
}

function AppDock({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = usePathname();
  const { data: approvals } = useQuery({
    queryKey: ["approvals"],
    queryFn: () => get<Approval[]>("/approvals"),
    refetchInterval: 30_000,
  });
  const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: () => get<ConfigStatus>("/health/config"), staleTime: 60_000 });
  const pending = approvals?.length ?? 0;

  const active = pathname.startsWith("/app/settings")
    ? "settings"
    : (NAV.find((n) => (n.exact ? pathname === n.href : pathname.startsWith(n.href)))?.id ?? null);

  const items: DockItem[] = NAV.map((n) => ({
    id: n.id,
    href: n.href,
    label: n.label,
    icon: n.icon,
    badge: n.id === "runs" && pending > 0 ? pending : null,
  }));
  const tools: DockItem[] = [
    { id: "search", label: "Search everything", icon: Search, onSelect: onOpenPalette, shortcut: "⌘K" },
    { id: "settings", href: "/app/settings", label: cfg && !cfg.llm.configured ? "Settings · set up a model" : "Settings", icon: Settings2, dot: !!cfg && !cfg.llm.configured },
  ];

  return <Dock label="Main" items={items} tools={tools} activeId={active} />;
}
