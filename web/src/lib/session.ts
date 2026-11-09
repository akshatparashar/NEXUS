"use client";

import { create } from "zustand";
import type { Session, User, Workspace } from "./types";

const WS_KEY = "nexus.workspace";

function readWs(): string | null {
  try {
    return localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
}

interface SessionState {
  status: "loading" | "authed" | "anon";
  token: string | null;
  user: User | null;
  workspaces: Workspace[];
  workspaceId: string | null;
  setSession: (s: Session) => void;
  setWorkspace: (id: string) => void;
  addWorkspace: (w: Workspace) => void;
  clear: () => void;
}

/** Access token lives in memory only; the refresh token is an httpOnly cookie the JS never sees. */
export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  token: null,
  user: null,
  workspaces: [],
  workspaceId: null,
  setSession: (s) => {
    const saved = get().workspaceId ?? readWs();
    const ws = s.workspaces.find((w) => w.id === saved) ?? s.workspaces[0] ?? null;
    set({ status: "authed", token: s.access_token, user: s.user, workspaces: s.workspaces, workspaceId: ws?.id ?? null });
  },
  setWorkspace: (id) => {
    try {
      localStorage.setItem(WS_KEY, id);
    } catch {
      /* private mode */
    }
    set({ workspaceId: id });
  },
  addWorkspace: (w) => set({ workspaces: [...get().workspaces, w] }),
  clear: () => set({ status: "anon", token: null, user: null, workspaces: [] }),
}));

export function currentWorkspace(): Workspace | null {
  const { workspaces, workspaceId } = useSession.getState();
  return workspaces.find((w) => w.id === workspaceId) ?? null;
}
