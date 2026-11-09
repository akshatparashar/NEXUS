"use client";

import { useSession } from "./session";

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshing: Promise<boolean> | null = null;

/** Exchange the httpOnly refresh cookie for a fresh access token (single flight). */
export async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "same-origin" });
        if (!r.ok) {
          useSession.getState().clear();
          return false;
        }
        useSession.getState().setSession(await r.json());
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

export function authHeaders(): Record<string, string> {
  const { token, workspaceId } = useSession.getState();
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (workspaceId) h["X-Workspace-Id"] = workspaceId;
  return h;
}

async function parseError(r: Response): Promise<ApiError> {
  try {
    const body = await r.json();
    if (body?.error) return new ApiError(r.status, body.error.code, body.error.message, body.error.details);
    if (body?.detail) {
      const msg = Array.isArray(body.detail)
        ? body.detail.map((d: { msg: string; loc?: string[] }) => `${d.loc?.slice(-1)[0] ?? ""}: ${d.msg}`).join("; ")
        : String(body.detail);
      return new ApiError(r.status, "validation_failed", msg);
    }
  } catch {
    /* not JSON */
  }
  return new ApiError(r.status, "http_error", r.status >= 500 ? "The server ran into a problem." : r.statusText);
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders(), ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  let r: Response;
  try {
    r = await fetch(`/api/v1${path}`, { ...init, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", "Can't reach the NEXUS API. Is the backend running?");
  }
  if (r.status === 401 && !retried && !path.startsWith("/auth/")) {
    if (await refreshSession()) return api<T>(path, init, true);
  }
  if (!r.ok) throw await parseError(r);
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, json?: unknown) => api<T>(path, { method: "POST", json });
export const put = <T,>(path: string, json?: unknown) => api<T>(path, { method: "PUT", json });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });
