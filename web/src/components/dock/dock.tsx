"use client";

import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { gsap, MOTION_OK, useGSAP } from "@/lib/gsap";

export interface DockItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  onSelect?: () => void;
  badge?: number | null;
  /** a small dot on the icon (e.g. "model not configured") */
  dot?: boolean;
  shortcut?: string;
}

interface DockProps {
  items: DockItem[];
  /** items after the divider: tools rather than places (search, settings) */
  tools?: DockItem[];
  activeId: string | null;
  /** the one primary action, drawn as a white capsule with a spectrum edge */
  action?: { label: string; href: string; icon?: LucideIcon };
  label: string;
  className?: string;
}

const MAG_RANGE = 120; // px from the pointer within which icons grow
const MAG_MAX = 1.38;

/**
 * The bottom dock. A small glass bar that is the main navigation on every page.
 * Desktop: icons magnify under the pointer like the macOS Dock, and a spectrum bar slides
 * under the current place. Phone: a regular tab bar, full width, icon over label.
 */
export function Dock({ items, tools = [], activeId, action, label, className }: DockProps) {
  const root = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);

  // magnification: one quickTo per icon, driven by pointer distance (gsap.utils.mapRange + clamp)
  useGSAP(
    (_, contextSafe) => {
      const el = root.current;
      if (!el || !contextSafe) return;
      const mm = gsap.matchMedia();
      mm.add(`${MOTION_OK} and (pointer: fine) and (min-width: 640px)`, () => {
        const icons = gsap.utils.toArray<HTMLElement>("[data-dock-icon]", el);
        const scaleTo = icons.map((i) => gsap.quickTo(i, "scale", { duration: 0.35, ease: "power3.out" }));
        const yTo = icons.map((i) => gsap.quickTo(i, "y", { duration: 0.35, ease: "power3.out" }));
        const toScale = gsap.utils.pipe(gsap.utils.clamp(0, MAG_RANGE), gsap.utils.mapRange(0, MAG_RANGE, MAG_MAX, 1));
        const onMove = contextSafe((e: PointerEvent) => {
          icons.forEach((icon, i) => {
            const r = icon.getBoundingClientRect();
            const s = toScale(Math.abs(e.clientX - (r.left + r.width / 2)));
            scaleTo[i](s);
            yTo[i]((1 - s) * 14);
          });
        });
        const onLeave = contextSafe(() => {
          scaleTo.forEach((f) => f(1));
          yTo.forEach((f) => f(0));
        });
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerleave", onLeave);
        return () => {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerleave", onLeave);
        };
      });
      // entrance: the dock rises into place once
      mm.add(MOTION_OK, () => {
        gsap.from(el, { y: 40, autoAlpha: 0, duration: 0.9, ease: "back.out(1.4)", delay: 0.35, clearProps: "transform,visibility,opacity" });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  // the spectrum indicator slides to the active item
  useLayoutEffect(() => {
    const el = root.current;
    const bar = indicator.current;
    if (!el || !bar) return;
    const place = () => {
      const target = activeId ? el.querySelector<HTMLElement>(`[data-dock-id="${CSS.escape(activeId)}"]`) : null;
      if (!target) {
        gsap.to(bar, { autoAlpha: 0, duration: 0.2 });
        return;
      }
      const x = target.offsetLeft + target.offsetWidth / 2 - bar.offsetWidth / 2;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.to(bar, { x, autoAlpha: 1, duration: reduce ? 0 : 0.55, ease: "elastic.out(1, 0.75)", overwrite: "auto" });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [activeId]);

  return (
    <nav
      ref={root}
      aria-label={label}
      className={clsx(
        "glass fixed z-50 flex items-end",
        // phone: a full-width tab bar; desktop: a centred floating dock
        "inset-x-2 bottom-2 h-[62px] justify-around rounded-[22px] px-1.5 pb-[7px]",
        "sm:inset-x-auto sm:bottom-5 sm:left-1/2 sm:h-[60px] sm:-translate-x-1/2 sm:justify-center sm:gap-1 sm:rounded-[22px] sm:px-2 sm:pb-[8px]",
        className,
      )}
      style={{ paddingBottom: "max(7px, env(safe-area-inset-bottom))" }}
    >
      <span ref={indicator} aria-hidden className="spectrum-fill pointer-events-none invisible absolute bottom-[5px] left-0 h-[3px] w-5 rounded-full opacity-0 sm:bottom-[4px]" />
      {items.map((item) => (
        <DockButton key={item.id} item={item} active={item.id === activeId} />
      ))}
      {tools.length > 0 && <span aria-hidden className="mx-1.5 mb-[9px] hidden h-7 w-px self-end bg-white/12 sm:block" />}
      {tools.map((item) => (
        <DockButton key={item.id} item={item} active={item.id === activeId} tool />
      ))}
      {action && (
        <>
          <span aria-hidden className="mx-1.5 mb-[9px] hidden h-7 w-px self-end bg-white/12 sm:block" />
          <Link
            href={action.href}
            className="spectrum-ring mb-[1px] hidden h-[42px] items-center gap-2 self-end whitespace-nowrap rounded-full bg-white px-4 text-[14px] font-semibold text-[#0b0b0d] transition-transform duration-200 ease-[var(--ease)] hover:-translate-y-0.5 active:scale-[0.97] sm:inline-flex"
          >
            {action.icon && <action.icon className="size-4" strokeWidth={2} aria-hidden />}
            {action.label}
          </Link>
        </>
      )}
    </nav>
  );
}

function DockButton({ item, active, tool = false }: { item: DockItem; active: boolean; tool?: boolean }) {
  const Icon = item.icon;
  const inner = (
    <>
      <span
        data-dock-icon
        className={clsx(
          "relative flex size-[38px] origin-bottom items-center justify-center rounded-[12px] transition-colors duration-200 will-change-transform sm:size-[42px] sm:rounded-[13px]",
          active ? "bg-white/[0.14] text-white" : "text-[#c7c7ce] group-hover:bg-white/[0.08] group-hover:text-white",
        )}
      >
        <Icon className="size-[19px] sm:size-[20px]" strokeWidth={active ? 2 : 1.7} aria-hidden />
        {item.badge ? (
          <span className="num absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-[#1b1203]">
            {item.badge}
          </span>
        ) : null}
        {item.dot && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-warning" />}
      </span>
      {/* phone: label under the icon; desktop: a glass tooltip above */}
      <span className={clsx("mt-0.5 text-[10px] font-medium leading-none sm:hidden", active ? "text-white" : "text-[#9a9aa3]", tool && "hidden")}>{item.label}</span>
      <span
        role="presentation"
        className="glass-strong pointer-events-none absolute -top-[60px] left-1/2 hidden -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium text-white invisible opacity-0 transition-[opacity,transform,visibility] duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:opacity-100 sm:block"
      >
        {item.label}
        {item.shortcut && <span className="ml-2 text-[#9a9aa3]">{item.shortcut}</span>}
      </span>
    </>
  );
  const cls = clsx("group relative flex min-w-0 flex-1 flex-col items-center justify-end outline-none sm:flex-none", tool && "hidden sm:flex");
  const a11y = { "aria-label": item.badge ? `${item.label}, ${item.badge} waiting` : item.label, "data-dock-id": item.id };
  if (item.href) {
    return (
      <Link href={item.href} {...a11y} aria-current={active ? "page" : undefined} className={cls} onClick={item.onSelect}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" {...a11y} aria-pressed={active || undefined} className={cls} onClick={item.onSelect}>
      {inner}
    </button>
  );
}
