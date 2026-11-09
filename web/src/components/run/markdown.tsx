"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Source } from "@/lib/types";

/** Agent Markdown with [n] citations turned into hoverable source chips. */
export function AgentMarkdown({ text, sources = [], onCite }: { text: string; sources?: Source[]; onCite?: (n: number) => void }) {
  const byN = new Map(sources.map((s) => [s.n, s]));
  // turn [3] into a link we can render as a chip
  const linked = text.replace(/\[(\d+)\](?!\()/g, (m, n) => (byN.has(Number(n)) ? `[${n}](#cite-${n})` : m));
  return (
    <div className="prose-agent">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const m = href?.match(/^#cite-(\d+)$/);
            if (m) {
              const s = byN.get(Number(m[1]));
              return (
                <button
                  type="button"
                  onClick={() => onCite?.(Number(m[1]))}
                  className="num mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-[4px] bg-[var(--pill-accent-bg)] px-1 align-middle text-[11px] text-[var(--pill-accent-ink)] transition-colors hover:bg-accent hover:text-white"
                  title={s ? `${s.filename}${s.page ? `, p.${s.page}` : ""}: ${s.excerpt.slice(0, 160)}…` : undefined}
                >
                  {m[1]}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {linked}
      </ReactMarkdown>
    </div>
  );
}
