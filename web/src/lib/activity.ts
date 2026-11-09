"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { create } from "zustand";
import { useSession } from "./session";
import { streamSSE } from "./sse";
import type { LifecycleEvent } from "./types";

interface ActivityState {
  connected: boolean;
  events: LifecycleEvent[];
  push: (e: LifecycleEvent) => void;
  setConnected: (v: boolean) => void;
  reset: () => void;
}

export const useActivity = create<ActivityState>((set, get) => ({
  connected: false,
  events: [],
  push: (e) => set({ events: [e, ...get().events].slice(0, 200) }),
  setConnected: (v) => set({ connected: v }),
  reset: () => set({ events: [], connected: false }),
}));

/** One workspace-wide SSE connection that keeps React Query caches fresh and feeds the activity stream. */
export function useActivityStream() {
  const qc = useQueryClient();
  const workspaceId = useSession((s) => s.workspaceId);
  const authed = useSession((s) => s.status === "authed");

  useEffect(() => {
    if (!authed || !workspaceId) return;
    const ctrl = new AbortController();
    const { push, setConnected, reset } = useActivity.getState();
    reset();
    let stopped = false;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const invalidate = (keys: string[][]) => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      }, 250);
    };

    (async () => {
      let backoff = 1000;
      while (!stopped) {
        try {
          await streamSSE("/stream/activity", {
            signal: ctrl.signal,
            onMessage: (m) => {
              if (m.event === "ready") {
                setConnected(true);
                backoff = 1000;
                return;
              }
              if (m.event !== "activity") return;
              const ev = JSON.parse(m.data) as LifecycleEvent;
              push(ev);
              if (ev.type.startsWith("document.")) invalidate([["documents"], ["overview"]]);
              else if (ev.type.startsWith("workflow.") || ev.type.startsWith("approval.")) {
                invalidate([["runs"], ["overview"], ["workflows"], ["approvals"], ["agents-stats"]]);
              } else if (ev.type.startsWith("agent.")) invalidate([["agents-stats"]]);
            },
          });
        } catch {
          /* dropped; retry below */
        }
        setConnected(false);
        if (stopped) break;
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 15000);
      }
    })();
    return () => {
      stopped = true;
      ctrl.abort();
      if (pending) clearTimeout(pending);
    };
  }, [authed, workspaceId, qc]);
}
