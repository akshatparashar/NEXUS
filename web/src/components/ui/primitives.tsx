"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { RotateCw, X } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* ── Card ─────────────────────────────────────────────────────────────────────────── */

export function Card({
  title,
  action,
  children,
  className,
  bodyClassName,
  sub,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  sub?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("flex min-w-0 flex-col rounded-[var(--radius-card)] bg-surface shadow-[var(--card-shadow)]", className)}>
      {(title || action) && (
        <header className="flex min-h-[52px] items-center justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[14px] font-semibold leading-5">{title}</h2>}
            {sub && <p className="truncate text-[12px] leading-4 text-muted">{sub}</p>}
          </div>
          {action && <div className="flex flex-none items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={clsx("min-w-0 flex-1 px-5 pb-5", !title && !action && "pt-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ── Tabs: the selection is a 1px accent line exactly as wide as its label ─────────── */

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: React.ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={clsx("flex items-end gap-6 border-b border-rule", className)}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.value)}
            className={clsx(
              "relative -mb-px flex h-9 items-center gap-1.5 text-[13px] transition-colors duration-150",
              on ? "text-text" : "text-muted hover:text-text",
            )}
          >
            {it.label}
            {it.count != null && <span className="num text-[11px] text-muted">{it.count}</span>}
            <span
              className={clsx(
                "absolute inset-x-0 bottom-0 h-px origin-center bg-accent transition-transform duration-200 ease-[var(--ease)]",
                on ? "scale-x-100" : "scale-x-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  items,
  size = "md",
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: React.ReactNode }[];
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-4">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(it.value)}
            className={clsx(
              "relative transition-colors duration-150",
              size === "sm" ? "h-6 text-[12px]" : "h-8 text-[13px]",
              on ? "text-text" : "text-muted hover:text-text",
            )}
          >
            {it.label}
            <span className={clsx("absolute inset-x-0 bottom-0 h-px bg-accent transition-opacity", on ? "opacity-100" : "opacity-0")} />
          </button>
        );
      })}
    </div>
  );
}

/* ── Fields ──────────────────────────────────────────────────────────────────────── */

const fieldBase =
  "w-full rounded-[var(--radius-field)] border border-control bg-[#0f0e12] px-3 text-[13px] text-text placeholder:text-muted outline-none transition-[border-color,box-shadow] duration-150 hover:border-[var(--control-hover)] focus:border-accent focus:shadow-[0_0_0_3px_rgb(76_141_255_/_0.18)] disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(fieldBase, "h-[34px]", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={clsx(fieldBase, "min-h-[84px] resize-y py-2 leading-5", className)} {...rest} />;
});

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  aside,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  htmlFor?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-text">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? <p className="text-[12px] text-[var(--pill-negative-ink)]">{error}</p> : hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative h-5 w-9 flex-none rounded-full border transition-colors duration-200",
        checked ? "border-accent bg-accent" : "border-control bg-[#0f0e12]",
      )}
    >
      <span
        className={clsx(
          "absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full transition-[left,background-color] duration-200 ease-[var(--ease)]",
          checked ? "left-[18px] bg-white" : "left-[2px] bg-[#8a8c92]",
        )}
      />
    </button>
  );
}

/* ── Skeleton: flat bars at the value's real size, no shimmer ────────────────────── */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={clsx("block rounded-[4px] bg-raised", className)} style={style} />;
}

/* ── Empty and error states inside the block that owns them ───────────────────────── */

export function Empty({ title, body, action, className }: { title: string; body?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col items-start gap-2 rounded-[var(--radius-card)] border border-dashed border-control px-4 py-4", className)}>
      <p className="text-[13px] font-medium">{title}</p>
      {body && <p className="max-w-[56ch] text-[13px] leading-5 text-muted">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = (error as { message?: string })?.message ?? "Something went wrong.";
  return (
    <div className="flex items-center gap-3 text-[13px] text-muted" role="alert">
      <span className="size-1.5 flex-none rounded-full bg-negative" />
      <span className="min-w-0 flex-1">{msg}</span>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1 text-text hover:text-accent-ink">
          <RotateCw className="size-3.5" aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

/* ── Popover menu (floating layer → glass) ───────────────────────────────────────── */

export function Menu({
  trigger,
  children,
  align = "start",
  width = 240,
}: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ width }}
            className={clsx(
              "glass absolute top-[calc(100%+6px)] z-50 origin-top rounded-[var(--radius-panel)] p-1",
              align === "end" ? "right-0" : "left-0",
            )}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  hint,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  icon?: React.ReactNode;
  danger?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onClick={onSelect}
      className={clsx(
        "flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] transition-colors duration-100 hover:bg-white/[0.06]",
        danger ? "text-[var(--pill-negative-ink)]" : "text-text",
      )}
    >
      {icon && <span className="flex size-4 items-center justify-center text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </button>
  );
}

/* ── Sheet / dialog (floating layer → glass) ─────────────────────────────────────── */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
}) {
  const id = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            style={{ width }}
            className="glass-strong relative max-w-full rounded-[14px] p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id={id} className="text-[16px] font-semibold">
                  {title}
                </h2>
                {description && <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p>}
              </div>
              <button onClick={onClose} aria-label="Close" className="-m-1 rounded-full p-1 text-muted hover:bg-white/5 hover:text-text">
                <X className="size-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ── Tooltip (CSS only, appears on hover/focus) ──────────────────────────────────── */

export function Tip({ label, children, side = "right" }: { label: string; children: React.ReactNode; side?: "right" | "bottom" | "top" }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={clsx(
          "glass pointer-events-none absolute z-50 whitespace-nowrap rounded-[6px] px-2 py-1 text-[12px] text-text opacity-0 transition-opacity delay-300 duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          side === "right" && "left-[calc(100%+10px)] top-1/2 -translate-y-1/2",
          side === "bottom" && "left-1/2 top-[calc(100%+8px)] -translate-x-1/2",
          side === "top" && "bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2",
        )}
      >
        {label}
      </span>
    </span>
  );
}

/* ── Page title row ──────────────────────────────────────────────────────────────── */

export function PageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.015em]">{title}</h1>
        {sub && <p className="mt-1 max-w-[80ch] text-[14px] leading-5 text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
