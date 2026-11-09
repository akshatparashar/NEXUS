"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true on the client afterwards (for portals). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** The current time, refreshed every `intervalMs` while `live` is true (for elapsed timers). */
export function useNow(live = true, intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [live, intervalMs]);
  return now;
}
