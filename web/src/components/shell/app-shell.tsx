"use client";

import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  Activity,
  BookOpen,
  Gauge,
  LayoutGrid,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Mark } from "@/components/brand";
import { Kbd } from "@/components/ui/pill";
import { Tip } from "@/components/ui/primitives";
import { get, refreshSession } from "@/lib/api";
import { useActivityStream, useActivity } from "@/lib/activity";
import { useSession } from "@/lib/session";
import type { Approval, ConfigStatus } from "@/lib/types";
import { CommandPalette, useCommandPalette } from "./command-palette";
import { TopBar } from "./top-bar";

const NAV = [
  { href: "/app", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/app/workflows", label: "Workflows", icon: WorkflowIcon },
  { href: "/app/runs", label: "Runs", icon: Activity, badge: "approvals" as const },
  { href: "/app/playground", label: "Playground", icon: MessagesSquare },
  { href: "/app/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/app/monitoring", label: "Monitoring", icon: Gauge },
];

const RAIL_KEY = "nexus.rail-expanded";

export function AppShell({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const palette = useCommandPalette();

  useEffect(() => {
    try {
      setExpanded(localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleRail = useCallback(() => {
    setExpanded((e) => {
      try {
        localStorage.setItem(RAIL_KEY, e ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !e;
    });
  }, []);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleRail();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRail]);

  useActivityStream();

  if (status !== "authed") return <BootScreen />;

  return (
    <div className="flex min-h-dvh">
      <Rail expanded={expanded} onToggle={toggleRail} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenPalette={() => palette.setOpen(true)} />
        <main className="min-w-0 flex-1 pb-[76px] md:pb-0">{children}</main>
      </div>
      <MobileNav />
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} onToggleRail={toggleRail} />
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

function Rail({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const connected = useActivity((s) => s.connected);
  const { data: approvals } = useQuery({
    queryKey: ["approvals"],
    queryFn: () => get<Approval[]>("/approvals"),
    refetchInterval: 30_000,
  });
  const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: () => get<ConfigStatus>("/health/config"), staleTime: 60_000 });
  const pending = approvals?.length ?? 0;

  return (
    <nav
      aria-label="Main"
      className={clsx(
        "sticky top-0 hidden h-dvh flex-none flex-col border-r border-border bg-ground transition-[width] duration-200 ease-[var(--ease)] md:flex",
        expanded ? "w-[224px]" : "w-[var(--rail)]",
      )}
    >
      <div className="flex h-12 items-center gap-2 px-[17px]">
        <Link href="/app" aria-label="NEXUS home" className="flex items-center gap-2.5 text-text">
          <Mark size={22} live={connected} />
          {expanded && <span className="text-[14px] font-semibold tracking-[-0.01em]">NEXUS</span>}
        </Link>
      </div>
      <ul className="mt-3 flex flex-col gap-1 px-2">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          const badge = item.badge === "approvals" && pending > 0 ? pending : null;
          const link = (
            <Link
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "relative flex h-10 items-center gap-3 rounded-[8px] px-[12px] text-[13px] transition-colors duration-150",
                active ? "text-text" : "text-muted hover:bg-raised hover:text-text",
              )}
            >
              {/* the selection mark: a 1px accent line on the rail's edge */}
              <span
                className={clsx(
                  "absolute -left-2 top-2 bottom-2 w-px bg-accent transition-opacity duration-150",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
              <Icon className="size-[17px] flex-none" strokeWidth={1.6} aria-hidden />
              {expanded && <span className="flex-1 truncate">{item.label}</span>}
              {badge != null && (
                <span
                  className={clsx(
                    "num flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--pill-warning-bg)] px-1 text-[10px] text-[var(--pill-warning-ink)]",
                    !expanded && "absolute right-1 top-1",
                  )}
                  aria-label={`${badge} waiting for approval`}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
          return <li key={item.href}>{expanded ? link : <Tip label={badge ? `${item.label} · ${badge} need approval` : item.label}>{link}</Tip>}</li>;
        })}
      </ul>
      <div className="mt-auto flex flex-col gap-1 px-2 pb-3">
        <Tip label={cfg?.llm.configured ? `Model: ${cfg.llm.provider} · ${cfg.llm.model}` : "Set up a model provider"}>
          <Link
            href="/app/settings"
            aria-label="Settings"
            className={clsx(
              "relative flex h-10 w-full items-center gap-3 rounded-[8px] px-[12px] text-[13px] transition-colors",
              pathname.startsWith("/app/settings") ? "text-text" : "text-muted hover:bg-raised hover:text-text",
            )}
          >
            <Settings2 className="size-[17px] flex-none" strokeWidth={1.6} aria-hidden />
            {expanded && <span className="flex-1">Settings</span>}
            {cfg && !cfg.llm.configured && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-warning" aria-label="Model not configured" />}
          </Link>
        </Tip>
        <button
          onClick={onToggle}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          className="flex h-10 items-center gap-3 rounded-[8px] px-[12px] text-[13px] text-muted transition-colors hover:bg-raised hover:text-text"
        >
          {expanded ? <PanelLeftClose className="size-[17px]" strokeWidth={1.6} /> : <PanelLeftOpen className="size-[17px]" strokeWidth={1.6} />}
          {expanded && (
            <span className="flex flex-1 items-center justify-between">
              Collapse <Kbd>⌘B</Kbd>
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-40 flex h-[60px] items-stretch justify-around px-2 md:hidden">
      {NAV.slice(0, 5).map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx("relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px]", active ? "text-text" : "text-muted")}
          >
            <Icon className="size-[18px]" strokeWidth={1.6} aria-hidden />
            {item.label}
            {active && <span className="absolute top-0 h-px w-8 bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );
}
