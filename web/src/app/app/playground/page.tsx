"use client";

import { clsx } from "clsx";
import { ArrowUp, ChevronDown, Plus, Search, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentTile } from "@/components/agent-tile";
import { AgentMarkdown } from "@/components/run/markdown";
import { Button, IconButton } from "@/components/ui/button";
import { Kbd } from "@/components/ui/pill";
import { Switch } from "@/components/ui/primitives";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { fmtInt, fmtRelative, plain } from "@/lib/format";
import { useSession } from "@/lib/session";
import { streamSSE } from "@/lib/sse";
import type { AgentType, SearchHit, Source } from "@/lib/types";

interface ToolTrace {
  tool: string;
  status: "running" | "done";
  query?: string;
  results?: (SearchHit & { n: number })[];
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  tool?: ToolTrace;
  error?: string;
  usage?: { tokens_in: number; tokens_out: number; model?: string };
  streaming?: boolean;
}
interface Chat {
  id: string;
  agent: AgentType;
  title: string;
  updated: string;
  messages: Msg[];
}

const KEY = (ws: string | null) => `nexus.playground.${ws ?? "none"}`;

function loadChats(ws: string | null): Chat[] {
  try {
    return JSON.parse(localStorage.getItem(KEY(ws)) ?? "[]");
  } catch {
    return [];
  }
}

export default function PlaygroundPage() {
  const ws = useSession((s) => s.workspaceId);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentType>("research");
  const [useKb, setUseKb] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = loadChats(ws);
    setChats(c);
    setActiveId(c[0]?.id ?? null);
    if (c[0]) setAgent(c[0].agent);
  }, [ws]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY(ws), JSON.stringify(chats.slice(0, 30)));
    } catch {
      /* storage full or blocked */
    }
  }, [chats, ws]);

  const active = chats.find((c) => c.id === activeId) ?? null;
  const messages = useMemo(() => active?.messages ?? [], [active]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const updateChat = (id: string, fn: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    let chat = active;
    if (!chat || chat.agent !== agent) {
      chat = { id: crypto.randomUUID(), agent, title: text.slice(0, 60), updated: new Date().toISOString(), messages: [] };
      setChats((cs) => [chat!, ...cs]);
      setActiveId(chat.id);
    }
    const chatId = chat.id;
    const history: Msg[] = [...chat.messages, { role: "user", content: text }];
    updateChat(chatId, (c) => ({ ...c, updated: new Date().toISOString(), messages: [...history, { role: "assistant", content: "", streaming: true }] }));
    setDraft("");
    setBusy(true);
    abort.current = new AbortController();

    const patchLast = (fn: (m: Msg) => Msg) =>
      updateChat(chatId, (c) => ({ ...c, messages: c.messages.map((m, i) => (i === c.messages.length - 1 ? fn(m) : m)) }));

    try {
      await streamSSE(`/agents/${agent}/chat`, {
        method: "POST",
        signal: abort.current.signal,
        json: { messages: history.map(({ role, content }) => ({ role, content })), use_knowledge: useKb },
        onMessage: (m) => {
          const d = JSON.parse(m.data);
          if (m.event === "tool") patchLast((x) => ({ ...x, tool: { tool: d.tool, status: d.status, query: d.args?.query, results: d.results } }));
          else if (m.event === "token") patchLast((x) => ({ ...x, content: x.content + d.text }));
          else if (m.event === "done") patchLast((x) => ({ ...x, streaming: false, usage: d }));
          else if (m.event === "error") patchLast((x) => ({ ...x, streaming: false, error: d.message }));
        },
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") patchLast((x) => ({ ...x, streaming: false, error: (e as Error).message }));
    } finally {
      patchLast((x) => ({ ...x, streaming: false }));
      setBusy(false);
    }
  };

  const meta = AGENTS[agent];

  return (
    <div className="flex h-[calc(100dvh-48px)] min-h-0">
      {/* left column: agent + history */}
      <aside className="hidden w-[280px] flex-none flex-col border-r border-border lg:flex" aria-label="Agents and history">
        <div className="px-4 pt-5">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Playground</h1>
          <p className="mt-1 text-[13px] leading-5 text-muted">Talk to one agent directly to try its prompt and tools.</p>
        </div>
        <ul className="mt-4 flex flex-col gap-0.5 px-2">
          {AGENT_ORDER.map((t) => (
            <li key={t}>
              <button
                onClick={() => setAgent(t)}
                className={clsx("relative flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left transition-colors", agent === t ? "bg-raised" : "hover:bg-raised/60")}
                aria-pressed={agent === t}
              >
                {agent === t && <span className="absolute -left-2 top-2 bottom-2 w-px bg-accent" />}
                <AgentTile type={t} size={26} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{AGENTS[t].label}</span>
                  <span className="block truncate text-[12px] text-muted">{AGENTS[t].description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex items-center justify-between px-4">
          <p className="text-[12px] text-muted">History</p>
          <IconButton
            label="New chat"
            onClick={() => {
              setActiveId(null);
              setDraft("");
            }}
          >
            <Plus className="size-4" />
          </IconButton>
        </div>
        <ul className="mt-1 flex-1 overflow-y-auto px-2 pb-4">
          {chats.length === 0 && <li className="px-2.5 py-2 text-[13px] text-muted">Conversations stay in this browser.</li>}
          {chats.map((c) => (
            <li key={c.id} className="group relative">
              <button
                onClick={() => {
                  setActiveId(c.id);
                  setAgent(c.agent);
                }}
                className={clsx("flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors", c.id === activeId ? "bg-raised" : "hover:bg-raised/60")}
              >
                <AgentTile type={c.agent} size={18} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{c.title}</span>
                  <span className="block text-[11px] text-muted">{fmtRelative(c.updated)}</span>
                </span>
              </button>
              <button
                aria-label="Delete conversation"
                onClick={() => {
                  setChats((cs) => cs.filter((x) => x.id !== c.id));
                  if (activeId === c.id) setActiveId(null);
                }}
                className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full p-1 text-muted hover:text-text group-hover:block"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* conversation */}
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
        <div className="flex h-12 flex-none items-center gap-3 border-b border-border px-4 md:px-6">
          <AgentTile type={agent} size={22} />
          <p className="text-[14px] font-semibold">{meta.label}</p>
          <select
            aria-label="Agent"
            value={agent}
            onChange={(e) => setAgent(e.target.value as AgentType)}
            className="rounded-[6px] border border-control bg-transparent px-2 py-1 text-[12px] lg:hidden"
          >
            {AGENT_ORDER.map((t) => (
              <option key={t} value={t} className="bg-surface">
                {AGENTS[t].label}
              </option>
            ))}
          </select>
          <label className="ml-auto flex items-center gap-2 text-[12px] text-muted">
            Use knowledge base
            <Switch checked={useKb} onChange={setUseKb} label="Use knowledge base" />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 py-8 md:px-6">
            {messages.length === 0 ? (
              <div className="pt-[8vh]">
                <AgentTile type={agent} size={40} />
                <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.01em]">Ask the {meta.label} agent</h2>
                <p className="mt-2 max-w-[56ch] text-[14px] leading-[22px] text-muted">
                  {meta.description}
                  {(agent === "research" || agent === "analyst") && useKb ? " It searches your knowledge base before answering and cites what it used." : ""}
                </p>
                <div className="mt-6 flex flex-col items-start gap-2">
                  {SUGGESTIONS[agent].map((s) => (
                    <button key={s} onClick={() => setDraft(s)} className="rounded-full border border-control px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-[var(--control-hover)] hover:text-text">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => <Message key={i} m={m} />)
            )}
            <div ref={bottom} />
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex-none px-4 pb-4 md:px-6"
        >
          <div className="glass mx-auto flex max-w-[760px] items-end gap-2 rounded-[14px] p-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={Math.min(6, Math.max(1, draft.split("\n").length))}
              placeholder={`Message the ${meta.label} agent…`}
              aria-label="Message"
              className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-5 text-text outline-none placeholder:text-muted"
            />
            {busy ? (
              <Button type="button" variant="secondary" size="sm" className="mb-1" icon={<Square className="size-3" />} onClick={() => abort.current?.abort()}>
                Stop
              </Button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                aria-label="Send"
                className="mb-1 flex size-8 flex-none items-center justify-center rounded-full bg-[#f2f2f3] text-[#111114] transition-[opacity,transform] active:scale-95 disabled:opacity-30"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
          <p className="mx-auto mt-2 max-w-[760px] text-center text-[12px] text-muted">
            <Kbd>↵</Kbd> to send · <Kbd>⇧</Kbd> <Kbd>↵</Kbd> for a new line
          </p>
        </form>
      </section>
    </div>
  );
}

const SUGGESTIONS: Record<AgentType, string[]> = {
  research: ["What do our documents say about pricing?", "List every deadline mentioned in the knowledge base."],
  analyst: ["What are the main risks in our documents, ranked?", "Compare the two strongest options and their trade-offs."],
  execution: ["Plan the steps to publish a weekly summary report.", "Which actions would need human approval, and why?"],
  reviewer: ["Review this claim: our churn fell because of the new onboarding.", "What makes a research brief complete?"],
};

function Message({ m }: { m: Msg }) {
  const [openTool, setOpenTool] = useState(false);
  if (m.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-[12px] bg-raised px-4 py-2.5 text-[14px] leading-[22px]">
        <p className="whitespace-pre-wrap">{m.content}</p>
      </div>
    );
  }
  const sources: Source[] = (m.tool?.results ?? []).map((h) => ({ n: h.n, chunk_id: h.chunk_id, document_id: h.document_id, filename: h.filename, page: h.page, score: h.score, excerpt: h.content }));
  return (
    <div className="rise">
      {m.tool && (
        <div className="mb-3">
          <button onClick={() => setOpenTool((o) => !o)} className="inline-flex items-center gap-2 rounded-full border border-control px-3 py-1 text-[12px] text-muted hover:text-text">
            {m.tool.status === "running" ? <span className="thinking-dot" /> : <Search className="size-3" />}
            {m.tool.status === "running" ? "Searching the knowledge base" : `Searched the knowledge base · ${m.tool.results?.length ?? 0} passages`}
            {m.tool.status === "done" && <ChevronDown className={clsx("size-3 transition-transform", openTool && "rotate-180")} />}
          </button>
          {openTool && m.tool.results && (
            <ol className="panel mt-2 flex flex-col gap-1.5 rounded-[12px] p-3">
              {m.tool.results.map((h) => (
                <li key={h.chunk_id} className="text-[12px] leading-[18px]">
                  <span className="num mr-1.5 rounded-[4px] bg-raised px-1 text-muted">{h.n}</span>
                  <span className="text-text">{h.filename}</span>
                  <span className="text-muted"> · {plain(h.content).slice(0, 140)}…</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {m.error ? (
        <p className="text-[14px] text-[var(--pill-negative-ink)]">{m.error}</p>
      ) : m.content ? (
        <div className={clsx(m.streaming && "caret")}>
          <AgentMarkdown text={m.content} sources={sources} />
        </div>
      ) : m.streaming ? (
        <p className="flex items-center gap-2 text-[13px] text-[var(--pill-thinking-ink)]">
          <span className="thinking-dot" /> Thinking
        </p>
      ) : null}
      {m.usage && (
        <p className="num mt-2 text-[11px] text-muted">
          {m.usage.model} · {fmtInt(m.usage.tokens_in)} in · {fmtInt(m.usage.tokens_out)} out
        </p>
      )}
    </div>
  );
}
