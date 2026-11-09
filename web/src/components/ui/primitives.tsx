"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Activity, BookOpen, Gauge, LayoutGrid, type LucideIcon, MessagesSquare, RotateCw, Settings2, Workflow as WorkflowIcon, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@/lib/hooks";

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
    <section className={clsx("panel flex min-w-0 flex-col rounded-[var(--radius-card)]", className)}>
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
                "spectrum-fill absolute inset-x-0 bottom-0 h-[2px] origin-center rounded-full transition-transform duration-200 ease-[var(--ease)]",
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
  "w-full rounded-[var(--radius-field)] border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] text-text placeholder:text-muted outline-none transition-[border-color,box-shadow,background-color] duration-150 hover:border-white/[0.14] focus:border-accent focus:bg-white/[0.06] focus:shadow-[0_0_0_4px_rgb(107_140_255_/_0.2)] disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(fieldBase, "h-9", className)} {...rest} />;
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
        "relative h-[22px] w-[38px] flex-none rounded-full transition-colors duration-200",
        checked ? "bg-positive" : "bg-white/[0.16]",
      )}
    >
      <span
        className={clsx(
          "absolute top-1/2 size-[18px] -translate-y-1/2 rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0_/_0.35)] transition-[left] duration-200 ease-[var(--ease-out-strong)]",
          checked ? "left-[18px]" : "left-[2px]",
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
  const mounted = useMounted();
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
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
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
            className="glass-strong relative max-w-full rounded-[var(--radius-panel)] p-6"
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

/** Each section of the app owns a colour from the agent spectrum; its header is lit with it. */
const PAGE_LOOK: { match: (p: string) => boolean; hue: string | "spectrum"; icon: LucideIcon }[] = [
  { match: (p) => p === "/app", hue: "spectrum", icon: LayoutGrid },
  { match: (p) => p.startsWith("/app/workflows"), hue: "var(--agent-analyst)", icon: WorkflowIcon },
  { match: (p) => p.startsWith("/app/runs"), hue: "var(--agent-execution)", icon: Activity },
  { match: (p) => p.startsWith("/app/playground"), hue: "var(--thinking)", icon: MessagesSquare },
  { match: (p) => p.startsWith("/app/knowledge"), hue: "var(--agent-research)", icon: BookOpen },
  { match: (p) => p.startsWith("/app/monitoring"), hue: "var(--agent-reviewer)", icon: Gauge },
  { match: (p) => p.startsWith("/app/settings"), hue: "#c9c9cf", icon: Settings2 },
];

export function PageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const look = PAGE_LOOK.find((l) => l.match(pathname));
  const Icon = look?.icon;
  const spectrum = look?.hue === "spectrum";
  return (
    <div className="relative mb-8 flex flex-wrap items-end justify-between gap-4">
      {look && (
        <span
          aria-hidden
          className={clsx("pointer-events-none absolute -left-16 -top-24 -z-10 h-56 w-[28rem] rounded-full opacity-50 blur-[80px]", spectrum && "spectrum-fill")}
          style={spectrum ? undefined : { background: look.hue }}
        />
      )}
      <div className="flex min-w-0 items-center gap-4">
        {Icon && (
          <span
            aria-hidden
            className={clsx("flex size-12 flex-none items-center justify-center rounded-[16px] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.25)]", spectrum && "spectrum-fill text-[#0b0b0d]")}
            style={spectrum ? undefined : { background: `color-mix(in oklab, ${look!.hue} 22%, rgb(255 255 255 / 0.04))`, color: look!.hue }}
          >
            <Icon className="size-[22px]" strokeWidth={1.9} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.03em] md:text-[34px] md:leading-10">{title}</h1>
          {sub && <p className="mt-1 max-w-[80ch] text-[15px] leading-6 text-muted">{sub}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
