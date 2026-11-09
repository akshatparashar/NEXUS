"use client";

import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const base =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium select-none transition-[background-color,border-color,color,transform,opacity,box-shadow,filter] duration-150 ease-[var(--ease)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45";

const variants: Record<Variant, string> = {
  // the primary is inverted (white pill, near-black label), per the dark style
  primary: "spectrum-ring bg-[#f5f5f7] text-[#0b0b0d] hover:bg-white hover:shadow-[0_8px_30px_rgb(139_133_255_/_0.35)]",
  // the one colourful action: the agent spectrum
  accent: "spectrum-fill text-[#0b0b0d] font-semibold hover:brightness-110 hover:shadow-[0_8px_28px_rgb(139_133_255_/_0.35)]",
  secondary: "bg-white/[0.07] text-text hover:bg-white/[0.12]",
  ghost: "text-muted hover:text-text hover:bg-white/[0.07]",
  danger: "bg-[var(--pill-negative-bg)] text-[var(--pill-negative-ink)] hover:bg-[rgb(255_90_82_/_0.22)]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[12px]",
  md: "h-9 px-4 text-[13px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button ref={ref} className={clsx(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex size-8 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-white/[0.08] hover:text-text active:scale-[0.95] disabled:opacity-40",
        active && "text-text",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
