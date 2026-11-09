"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { FileText, RotateCcw, Search, Trash2, UploadCloud, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Meter } from "@/components/charts/charts";
import { AgentMarkdown } from "@/components/run/markdown";
import { Button, IconButton } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Card, Dialog, Empty, ErrorNote, Input, PageHeader, Segmented, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { ApiError, authHeaders, del, get, post, refreshSession } from "@/lib/api";
import { fmtBytes, fmtInt, fmtRelative, plain } from "@/lib/format";
import { streamSSE } from "@/lib/sse";
import type { DocumentRow, SearchHit, Source } from "@/lib/types";

const ACCEPT = ".pdf,.txt,.md";
const MAX_MB = 20;

export default function KnowledgePage() {
  return (
    <Suspense>
      <Knowledge />
    </Suspense>
  );
}

function Knowledge() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const docs = useQuery({
    queryKey: ["documents"],
    queryFn: () => get<DocumentRow[]>("/documents"),
    refetchInterval: (q) => ((q.state.data ?? []).some((d) => !["ready", "failed"].includes(d.status)) ? 1500 : false),
  });
  const [uploads, setUploads] = useState<{ name: string; progress: number; error?: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<DocumentRow | null>(null);
  const [view, setView] = useState<DocumentRow | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (params.get("upload")) input.current?.click();
  }, [params]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (!["pdf", "txt", "md"].includes(ext ?? "")) {
          toast.error(`${file.name} was not added`, "Only PDF, TXT and Markdown files can be added.");
          continue;
        }
        if (file.size > MAX_MB * 1024 * 1024) {
          toast.error(`${file.name} is too large`, `Files can be at most ${MAX_MB} MB.`);
          continue;
        }
        setUploads((u) => [...u, { name: file.name, progress: 0 }]);
        try {
          await xhrUpload(file, (p) => setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, progress: p } : x))));
          qc.invalidateQueries({ queryKey: ["documents"] });
        } catch (e) {
          toast.error(`${file.name} was not added`, (e as Error).message);
        } finally {
          setUploads((u) => u.filter((x) => x.name !== file.name));
        }
      }
    },
    [qc],
  );

  const remove = async () => {
    if (!confirm) return;
    try {
      await del(`/documents/${confirm.id}`);
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast.success(`Removed ${confirm.filename}`);
    } catch (e) {
      toast.error("Couldn't remove the document", (e as Error).message);
    }
    setConfirm(null);
  };

  const list = docs.data ?? [];
  const ready = list.filter((d) => d.status === "ready");

  return (
    <div
      className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-8"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        uploadFiles(e.dataTransfer.files);
      }}
    >
      <PageHeader
        title="Knowledge"
        sub={
          docs.data
            ? `${fmtInt(ready.length)} ${ready.length === 1 ? "document" : "documents"} ready · ${fmtInt(ready.reduce((a, d) => a + d.chunk_count, 0))} chunks indexed for hybrid search.`
            : " "
        }
        actions={
          <>
            <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
            <Button variant="primary" icon={<UploadCloud className="size-3.5" />} onClick={() => input.current?.click()}>
              Upload
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="Documents" className="min-w-0">
          <div
            className={clsx(
              "mb-4 flex items-center gap-4 rounded-[var(--radius-card)] border border-dashed px-5 py-4 transition-colors",
              dragging
                ? "border-research bg-[color-mix(in_oklab,var(--agent-research)_14%,transparent)]"
                : "border-[color-mix(in_oklab,var(--agent-research)_35%,transparent)] bg-[color-mix(in_oklab,var(--agent-research)_5%,transparent)]",
            )}
          >
            <UploadCloud className="size-5 flex-none text-research" />
            <p className="flex-1 text-[13px] leading-5 text-muted">
              <span className="text-text">Drop PDF, TXT or Markdown files anywhere on this page.</span> Up to {MAX_MB} MB each. Files are parsed, chunked
              and embedded in the background.
            </p>
          </div>
          {uploads.map((u) => (
            <div key={u.name} className="panel mb-2 rounded-[var(--radius-card)] px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-[13px]">
                <span className="truncate">{u.name}</span>
                <span className="num text-muted">{u.progress}% uploaded</span>
              </div>
              <Meter value={u.progress} max={100} tone="var(--accent)" label={`Uploading ${u.name}`} />
            </div>
          ))}
          {docs.error ? (
            <ErrorNote error={docs.error} onRetry={() => docs.refetch()} />
          ) : docs.isLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[64px] w-full" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <Empty
              title="The knowledge base is empty"
              body="Agents search what you add here and cite it in their answers. Start with a report, a policy or meeting notes."
              action={<Button size="sm" variant="primary" onClick={() => input.current?.click()}>Upload a document</Button>}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((d) => (
                <DocRow key={d.id} doc={d} onOpen={() => setView(d)} onDelete={() => setConfirm(d)} />
              ))}
            </ul>
          )}
        </section>
        <SearchPanel hasDocs={ready.length > 0} />
      </div>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={`Remove ${confirm?.filename}?`} description="Its chunks leave the index at once. Past runs keep their citations." width={440}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={remove} icon={<Trash2 className="size-3.5" />}>
            Remove document
          </Button>
        </div>
      </Dialog>
      {view && <DocViewer doc={view} onClose={() => setView(null)} />}
    </div>
  );
}

function xhrUpload(file: File, onProgress: (p: number) => void, retried = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/documents");
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = async () => {
      if (xhr.status === 401 && !retried && (await refreshSession())) return xhrUpload(file, onProgress, true).then(resolve, reject);
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      try {
        const body = JSON.parse(xhr.responseText);
        reject(new ApiError(xhr.status, body?.error?.code ?? "upload_failed", body?.error?.message ?? "Upload failed."));
      } catch {
        reject(new Error("Upload failed."));
      }
    };
    xhr.onerror = () => reject(new Error("Can't reach the server."));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

const STAGE: Record<DocumentRow["status"], string> = {
  uploaded: "Queued",
  parsing: "Reading",
  embedding: "Embedding",
  ready: "Ready",
  failed: "Failed",
};

function DocRow({ doc, onOpen, onDelete }: { doc: DocumentRow; onOpen: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const processing = !["ready", "failed"].includes(doc.status);
  return (
    <li className="panel panel-hover group flex items-center gap-4 rounded-[var(--radius-card)] px-4 py-3">
      <span className="flex size-10 flex-none items-center justify-center rounded-[12px] bg-[color-mix(in_oklab,var(--agent-research)_16%,transparent)] text-research">
        <FileText className="size-5" strokeWidth={1.6} />
      </span>
      <button onClick={onOpen} disabled={doc.status !== "ready"} className="min-w-0 flex-1 text-left disabled:cursor-default">
        <p className="truncate text-[13px] font-medium group-hover:text-accent-ink">{doc.filename}</p>
        {processing ? (
          <div className="mt-1.5 flex items-center gap-3">
            <div className="flex-1">
              <Meter value={doc.progress} max={100} tone="var(--thinking)" label={`Processing ${doc.filename}`} />
            </div>
            <span className="num w-[110px] flex-none text-right text-[12px] text-muted">
              {STAGE[doc.status]} · {doc.progress}%
            </span>
          </div>
        ) : doc.status === "failed" ? (
          <p className="truncate text-[12px] text-[var(--pill-negative-ink)]">{doc.error}</p>
        ) : (
          <p className="num truncate text-[12px] text-muted">
            {fmtBytes(doc.size_bytes)}
            {doc.pages ? ` · ${doc.pages} pages` : ""} · {fmtInt(doc.chunk_count)} chunks · {fmtInt(doc.token_count)} tokens · {fmtRelative(doc.created_at)}
          </p>
        )}
      </button>
      {doc.status === "ready" && <Pill tone="positive">Ready</Pill>}
      {doc.status === "failed" && (
        <Button
          size="sm"
          variant="secondary"
          icon={<RotateCcw className="size-3" />}
          onClick={async () => {
            try {
              await post(`/documents/${doc.id}/reprocess`);
              qc.invalidateQueries({ queryKey: ["documents"] });
            } catch (e) {
              toast.error("Couldn't retry", (e as Error).message);
            }
          }}
        >
          Retry
        </Button>
      )}
      <IconButton label={`Remove ${doc.filename}`} onClick={onDelete} className="opacity-60 group-hover:opacity-100">
        <Trash2 className="size-3.5" />
      </IconButton>
    </li>
  );
}

function SearchPanel({ hasDocs }: { hasDocs: boolean }) {
  const [mode, setMode] = useState<"ask" | "search">("ask");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [answer, setAnswer] = useState<{ text: string; sources: Source[]; cited: number[]; done: boolean; error?: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setHits(null);
    setAnswer(null);
    try {
      if (mode === "search") {
        const r = await post<{ results: SearchHit[] }>("/search", { query: q, k: 8 });
        setHits(r.results);
      } else {
        abort.current?.abort();
        abort.current = new AbortController();
        let sources: Source[] = [];
        setAnswer({ text: "", sources: [], cited: [], done: false });
        await streamSSE("/ask", {
          method: "POST",
          json: { question: q },
          signal: abort.current.signal,
          onMessage: (m) => {
            const d = JSON.parse(m.data);
            if (m.event === "sources") {
              sources = d.map((h: SearchHit & { n: number }) => ({ n: h.n, chunk_id: h.chunk_id, document_id: h.document_id, filename: h.filename, page: h.page, score: h.score, excerpt: h.content }));
              setAnswer((a) => a && { ...a, sources });
            } else if (m.event === "token") setAnswer((a) => a && { ...a, text: a.text + d.text });
            else if (m.event === "done") setAnswer((a) => a && { ...a, cited: d.cited ?? [], done: true });
            else if (m.event === "error") setAnswer((a) => a && { ...a, error: d.message, done: true });
          },
        });
      }
    } catch (err) {
      toast.error(mode === "ask" ? "Couldn't answer" : "Search failed", (err as Error).message);
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Ask the knowledge base"
      sub="Hybrid retrieval: vector similarity and full-text search, fused with Reciprocal Rank Fusion"
      action={
        <Segmented
          size="sm"
          label="Mode"
          value={mode}
          onChange={(v) => {
            setMode(v);
            setHits(null);
            setAnswer(null);
          }}
          items={[
            { value: "ask", label: "Answer" },
            { value: "search", label: "Passages" },
          ]}
        />
      }
      className="xl:sticky xl:top-[72px] xl:self-start"
    >
      <form onSubmit={run} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={hasDocs ? (mode === "ask" ? "What does the policy say about refunds?" : "refund policy") : "Add a document first"}
            className="pl-8"
            disabled={!hasDocs}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button type="submit" variant="primary" loading={busy} disabled={!hasDocs || !query.trim()}>
          {mode === "ask" ? "Ask" : "Search"}
        </Button>
      </form>

      <div className="mt-5 min-h-[120px]">
        {!hasDocs && <p className="text-[13px] text-muted">Search becomes available once a document is ready.</p>}
        {hasDocs && !hits && !answer && (
          <p className="text-[13px] leading-5 text-muted">
            <span className="text-text">Answer</span> writes a reply grounded in the top passages, with numbered citations. <span className="text-text">Passages</span> shows the ranked chunks with
            their vector and keyword ranks, so you can see why each one was chosen.
          </p>
        )}
        {answer && (
          <div className="rise">
            {answer.error ? (
              <p className="text-[13px] text-[var(--pill-negative-ink)]">{answer.error}</p>
            ) : (
              <div className={clsx(!answer.done && "caret")}>
                <AgentMarkdown text={answer.text || " "} sources={answer.sources} onCite={(n) => document.getElementById(`ask-src-${n}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })} />
              </div>
            )}
            {answer.sources.length > 0 && (
              <ol className="mt-5 flex flex-col">
                {answer.sources.map((s) => (
                  <li key={s.chunk_id} id={`ask-src-${s.n}`} className="border-t border-rule py-2.5">
                    <p className="flex items-center gap-2 text-[13px]">
                      <span className={clsx("num flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 text-[11px]", answer.cited.includes(s.n) ? "bg-accent text-white" : "bg-raised text-muted")}>
                        {s.n}
                      </span>
                      <span className="truncate font-medium">{s.filename}</span>
                      {s.page && <span className="num text-[12px] text-muted">p.{s.page}</span>}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-[18px] text-muted">{plain(s.excerpt)}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {hits && (
          <div className="rise">
            {hits.length === 0 ? (
              <p className="text-[13px] text-muted">No passage matches. Try other words, or add a document that covers this.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="h-8 font-normal">Passage</th>
                    <th className="w-16 text-right font-normal">Vector</th>
                    <th className="w-16 text-right font-normal">Keyword</th>
                    <th className="w-16 text-right font-normal">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {hits.map((h) => (
                    <tr key={h.chunk_id} className="border-t border-rule align-top">
                      <td className="py-2.5 pr-4">
                        <p className="text-[12px] font-medium">
                          {h.filename}
                          {h.page ? <span className="num text-muted"> · p.{h.page}</span> : null}
                        </p>
                        <p className="mt-0.5 line-clamp-3 text-[12px] leading-[18px] text-muted">{plain(h.content)}</p>
                      </td>
                      <td className="num py-2.5 text-right text-muted">{h.vector_rank ? `#${h.vector_rank}` : "—"}</td>
                      <td className="num py-2.5 text-right text-muted">{h.keyword_rank ? `#${h.keyword_rank}` : "—"}</td>
                      <td className="num py-2.5 text-right">{h.score.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function DocViewer({ doc, onClose }: { doc: DocumentRow; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["document", doc.id],
    queryFn: () => get<{ chunks: { id: string; ordinal: number; page: number | null; token_count: number; content: string }[] }>(`/documents/${doc.id}`),
  });
  return (
    <Dialog open onClose={onClose} title={doc.filename} description={`${fmtInt(doc.chunk_count)} chunks · ${fmtInt(doc.token_count)} tokens · how the agents see this document`} width={720}>
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {q.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ol className="flex flex-col gap-2">
            {q.data?.chunks.map((c) => (
              <li key={c.id} className="rounded-[8px] bg-black/25 p-3">
                <p className="num mb-1 text-[11px] text-muted">
                  chunk {c.ordinal}
                  {c.page ? ` · page ${c.page}` : ""} · {c.token_count} tokens
                </p>
                <p className="whitespace-pre-wrap text-[13px] leading-5">{c.content}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Dialog>
  );
}
