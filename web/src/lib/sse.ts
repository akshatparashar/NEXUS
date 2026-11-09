"use client";

import { authHeaders, refreshSession } from "./api";

export interface SSEMessage {
  event: string;
  data: string;
  id?: string;
}

/**
 * Server-Sent Events over fetch (EventSource cannot send an Authorization header).
 * Works for GET streams and POST streams alike. Resolves when the stream ends.
 */
export async function streamSSE(
  path: string,
  opts: {
    method?: "GET" | "POST";
    json?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    onMessage: (m: SSEMessage) => void;
  },
  retried = false,
): Promise<void> {
  const headers: Record<string, string> = { Accept: "text/event-stream", ...authHeaders(), ...opts.headers };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  const r = await fetch(`/api/v1${path}`, { method: opts.method ?? "GET", headers, body, signal: opts.signal, credentials: "same-origin" });
  if (r.status === 401 && !retried && (await refreshSession())) return streamSSE(path, opts, true);
  if (!r.ok || !r.body) {
    let message = `Stream failed (${r.status})`;
    try {
      const j = await r.json();
      message = j?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value.replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const msg: SSEMessage = { event: "message", data: "" };
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const c = line.indexOf(":");
        const field = c < 0 ? line : line.slice(0, c);
        const val = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "");
        if (field === "event") msg.event = val;
        else if (field === "data") data.push(val);
        else if (field === "id") msg.id = val;
      }
      if (!data.length && msg.event === "message") continue;
      msg.data = data.join("\n");
      opts.onMessage(msg);
    }
  }
}
