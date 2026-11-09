"use client";

import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { create } from "zustand";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}

const useToasts = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, "id">) => void; dismiss: (id: number) => void }>((set, get) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set({ items: [...get().items.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.kind === "error" ? 7000 : 4200);
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
}));

export const toast = {
  success: (title: string, body?: string, action?: ToastItem["action"]) => useToasts.getState().push({ kind: "success", title, body, action }),
  error: (title: string, body?: string) => useToasts.getState().push({ kind: "error", title, body }),
  info: (title: string, body?: string, action?: ToastItem["action"]) => useToasts.getState().push({ kind: "info", title, body, action }),
};

const icons = {
  success: <CircleCheck className="size-4 text-positive" aria-hidden />,
  error: <CircleAlert className="size-4 text-negative" aria-hidden />,
  info: <Info className="size-4 text-accent-ink" aria-hidden />,
};

export function Toaster() {
  const { items, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="glass pointer-events-auto flex items-start gap-3 rounded-[var(--radius-panel)] px-4 py-3"
            role={t.kind === "error" ? "alert" : "status"}
          >
            <span className="mt-0.5">{icons[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[12px] leading-[18px] text-muted">{t.body}</p>}
            </div>
            {t.action && (
              <button
                className="text-[12px] font-medium text-accent-ink hover:text-text"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
