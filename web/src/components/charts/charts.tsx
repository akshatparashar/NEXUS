"use client";

import { useEffect, useRef, useState } from "react";
import { niceTicks } from "@/lib/format";

function useWidth(min = 280) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

function xPicks(n: number, width: number, labelLen: number) {
  const cap = Math.max(2, Math.min(8, Math.floor(width / (labelLen * 7 + 24))));
  if (n <= cap) return [...Array(n).keys()];
  let k = Math.ceil(n / cap);
  // prefer a step that lands on the last label
  for (let s = k; s <= k + 3; s++) if ((n - 1) % s === 0) return [...Array(n).keys()].filter((i) => i % s === 0);
  k = Math.ceil((n - 1) / (cap - 1));
  return [...Array(n).keys()].filter((i) => i % k === 0);
}

export interface Segment {
  key: string;
  label: string;
  color: string;
}

/**
 * Columns per period, optionally stacked. Square corners, 2px seams, zero baseline, round ticks above the max.
 */
export function Columns({
  labels,
  series,
  segments,
  height = 180,
  format = (v: number) => String(v),
  ariaLabel,
}: {
  labels: string[];
  series: Record<string, number[]>;
  segments: Segment[];
  height?: number;
  format?: (v: number) => string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth();
  const totals = labels.map((_, i) => segments.reduce((a, s) => a + (series[s.key]?.[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const ticks = niceTicks(0, max, 4).map((t) => Math.round(t));
  const top = ticks[ticks.length - 1];
  const padL = 36;
  const padB = 22;
  const plotW = width - padL;
  const plotH = height - padB - 6;
  const slot = plotW / labels.length;
  const bw = Math.max(4, Math.min(28, slot * 0.62));
  const picks = new Set(xPicks(labels.length, plotW, Math.max(...labels.map((l) => l.length))));
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => {
          const y = 6 + plotH - (t / top) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={width} y1={y} y2={y} stroke={t === 0 ? "#4a4a50" : "var(--grid)"} strokeWidth={1} />
              <text x={padL - 8} y={y + 4} fontSize={11} fill="var(--muted)" textAnchor="end" className="num">
                {format(t)}
              </text>
            </g>
          );
        })}
        {labels.map((l, i) => {
          let acc = 0;
          const cx = padL + slot * i + slot / 2;
          return (
            <g key={l + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + slot * i} y={0} width={slot} height={height - padB} fill={hover === i ? "rgb(255 255 255 / 0.03)" : "transparent"} />
              {segments.map((s) => {
                const v = series[s.key]?.[i] ?? 0;
                if (!v) return null;
                const hgt = (v / top) * plotH;
                const y = 6 + plotH - ((acc + v) / top) * plotH;
                acc += v;
                return <rect key={s.key} x={cx - bw / 2} y={y} width={bw} height={Math.max(1, hgt - (acc > v ? 2 : 0))} fill={s.color} />;
              })}
              {picks.has(i) && (
                <text x={cx} y={height - 6} fontSize={11} fill="var(--muted)" textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"} dx={i === 0 ? -bw / 2 : i === labels.length - 1 ? bw / 2 : 0}>
                  {l}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div
          className="glass pointer-events-none absolute top-0 z-10 rounded-[6px] px-2.5 py-1.5 text-[12px]"
          style={{ left: Math.min(width - 160, Math.max(0, padL + slot * hover + slot / 2 - 70)) }}
        >
          <p className="font-medium">{labels[hover]}</p>
          {segments.map((s) => (
            <p key={s.key} className="flex items-center gap-1.5 text-muted">
              <span className="size-1.5 rounded-full" style={{ background: s.color }} />
              {s.label} <span className="num ml-auto pl-3 text-text">{format(series[s.key]?.[hover] ?? 0)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for a ranking: label, thin bar, value. One hue, no track. */
export function BarList({
  rows,
  format = (v: number) => String(v),
  color = "var(--chart-1)",
}: {
  rows: { label: React.ReactNode; value: number; sub?: React.ReactNode; tone?: string }[];
  format?: (v: number) => string;
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <li key={i}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="num flex-none text-text">{format(r.value)}</span>
          </div>
          <div className="mt-1.5 h-[3px] w-full">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 88}%`, background: r.tone ?? color }} />
          </div>
          {r.sub && <p className="mt-1 text-[12px] text-muted">{r.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

/** A progress bar at the true ratio, both ends labelled. */
export function Meter({ value, max, label, tone = "var(--chart-1)" }: { value: number; max: number; label?: string; tone?: string }) {
  const pct = max ? Math.min(1, value / max) : 0;
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
        {pct > 0 && <div className="h-full rounded-full transition-[width] duration-500 ease-[var(--ease)]" style={{ width: `${pct * 100}%`, background: tone }} />}
      </div>
    </div>
  );
}
