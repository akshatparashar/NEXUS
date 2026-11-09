import { CheckCheck, Library, type LucideIcon, Sparkles, Wrench } from "lucide-react";
import type { AgentType, RunStatus } from "./types";

export interface AgentMeta {
  type: AgentType;
  label: string;
  verb: string;
  description: string;
  icon: LucideIcon;
  hue: string; // CSS var for identity tint (never status)
}

export const AGENTS: Record<AgentType, AgentMeta> = {
  research: {
    type: "research",
    label: "Research",
    verb: "Researching",
    description: "Searches the knowledge base and reports cited findings.",
    icon: Library,
    hue: "var(--agent-research)",
  },
  analyst: {
    type: "analyst",
    label: "Analyst",
    verb: "Analysing",
    description: "Finds patterns, gaps and implications in upstream work.",
    icon: Sparkles,
    hue: "var(--agent-analyst)",
  },
  execution: {
    type: "execution",
    label: "Execution",
    verb: "Acting",
    description: "Turns findings into actions with approved tools.",
    icon: Wrench,
    hue: "var(--agent-execution)",
  },
  reviewer: {
    type: "reviewer",
    label: "Reviewer",
    verb: "Reviewing",
    description: "Checks the work and sends it back for revision if needed.",
    icon: CheckCheck,
    hue: "var(--agent-reviewer)",
  },
};

export const AGENT_ORDER: AgentType[] = ["research", "analyst", "execution", "reviewer"];

export const TOOLS = [
  { name: "kb_search", label: "Search knowledge base", destructive: false },
  { name: "save_report", label: "Save a report", destructive: false },
  { name: "http_get", label: "Fetch an allowlisted web page", destructive: false },
  { name: "send_webhook", label: "Send a webhook", destructive: true },
  { name: "delete_document", label: "Delete a document", destructive: true },
] as const;

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  awaiting_approval: "Needs approval",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
};

export const TERMINAL: RunStatus[] = ["succeeded", "failed", "cancelled", "timed_out"];
