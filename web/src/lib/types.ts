/** Heterogeneous JSON from the server (event payloads, step outputs); read fields defensively. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonObject = Record<string, any>;

export type AgentType = "research" | "analyst" | "execution" | "reviewer";

export type RunStatus = "queued" | "running" | "awaiting_approval" | "succeeded" | "failed" | "cancelled" | "timed_out";

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface Session {
  access_token: string;
  expires_in: number;
  user: User;
  workspaces: Workspace[];
}

export interface NodeData {
  label: string;
  instructions?: string;
  temperature?: number | null;
  model?: string | null;
  tools?: string[] | null;
  maxRevisions?: number;
  topK?: number;
  [key: string]: unknown;
}

export interface GraphNode {
  id: string;
  type: AgentType;
  position: { x: number; y: number };
  data: NodeData;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport?: { x: number; y: number; zoom: number } | null;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  graph: Graph;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  node_count: number;
  agent_types: AgentType[];
  updated_at: string;
  last_run_status: RunStatus | null;
  last_run_at: string | null;
  run_count: number;
}

export interface Source {
  n: number;
  chunk_id: string;
  document_id: string;
  filename: string;
  page: number | null;
  score: number;
  excerpt: string;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  status?: string;
  destructive?: boolean;
}

export interface Step {
  id: string;
  node_id: string;
  agent_type: AgentType;
  label: string;
  iteration: number;
  attempt: number;
  status: "running" | "succeeded" | "failed" | "awaiting_approval" | "cancelled";
  input_summary: string;
  output: JsonObject | null;
  error: string | null;
  tools: ToolCall[];
  tokens_in: number;
  tokens_out: number;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface ApprovalAction {
  index: number;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

export interface Approval {
  id: string;
  run_id: string;
  node_id: string;
  actions: ApprovalAction[];
  status: "pending" | "approved" | "rejected";
  decision: { approved: Record<string, boolean>; note: string; by?: string } | null;
  created_at: string;
  decided_at: string | null;
}

export interface Artifact {
  id: string;
  node_id: string;
  kind: string;
  title: string;
  content: string;
  created_at: string;
}

export interface RunSummary {
  id: string;
  workflow_id: string;
  workflow_name: string;
  workflow_version: number;
  status: RunStatus;
  input: { task?: string };
  error: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  tokens_in: number;
  tokens_out: number;
  retry_of: string | null;
}

export interface RunOutput {
  summary: string;
  primary_node: string | null;
  review: { verdict: string; score: number; issues: string[]; summary: string; revision_cap_reached: boolean } | null;
  revisions: Record<string, number>;
  sources: Source[];
  nodes: Record<string, { label: string; type: AgentType; summary: string }>;
  usage: { input?: number; output?: number };
}

export interface Run extends RunSummary {
  graph_snapshot: Graph;
  output: RunOutput | null;
  steps: Step[];
  approvals: Approval[];
  artifacts: Artifact[];
  last_seq: number;
}

export interface LifecycleEvent {
  event_id: string;
  type: string;
  seq: number | null;
  run_id: string | null;
  step_id?: string | null;
  occurred_at: string;
  payload: JsonObject;
}

export interface DocumentRow {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  status: "uploaded" | "parsing" | "embedding" | "ready" | "failed";
  progress: number;
  pages: number | null;
  chunk_count: number;
  token_count: number;
  error: string | null;
  created_at: string;
  ready_at: string | null;
}

export interface SearchHit {
  chunk_id: string;
  document_id: string;
  filename: string;
  page: number | null;
  ordinal: number;
  content: string;
  score: number;
  similarity: number | null;
  vector_rank: number | null;
  keyword_rank: number | null;
  n?: number;
}

export interface ConfigStatus {
  app: string;
  run_mode: string;
  llm: { provider: string; model: string; configured: boolean; reachable?: boolean; model_available?: boolean };
  embeddings: { provider: string; model: string; dim: number };
  database: { ok: boolean; latency_ms?: number; pgvector?: string; error?: string };
  event_bus: { kind: string; ok: boolean; bootstrap: string | null };
  realtime: { kind: string; ok: boolean };
  limits: Record<string, number>;
}
