const nf0 = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const MINUS = "−";

export const fmtInt = (v: number | null | undefined) => (v == null ? "—" : nf0.format(v));
export const fmtCompact = (v: number | null | undefined) => (v == null ? "—" : compact.format(v));
export const fmtPct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${new Intl.NumberFormat("en", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v * 100)}%`;

export function fmtSigned(v: number) {
  return (v > 0 ? "+" : v < 0 ? MINUS : "") + nf0.format(Math.abs(v));
}

/** Durations the way people say them: 840 ms, 12.4 s, 3 m 05 s, 1 h 02 m. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${nf0.format(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${nf1.format(s)} s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m} m ${String(rs).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`;
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${nf1.format(b / 1024)} KB`;
  return `${nf1.format(b / 1024 / 1024)} MB`;
}

export function fmtRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const d = (now - new Date(iso).getTime()) / 1000;
  if (d < 5) return "just now";
  if (d < 60) return `${Math.floor(d)} s ago`;
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short" });
}

export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function shortId(id: string) {
  return id.slice(0, 8);
}

/** Round ticks (1, 2, 2.5, 5 × 10^n) whose top sits above the largest value. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= max) hi += step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Passage text for display: Markdown markers removed, whitespace collapsed. */
export function plain(text: string): string {
  return text
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
