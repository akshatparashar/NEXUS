"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addEdge,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowUpRight, GripVertical, Play, Square } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentTile } from "@/components/agent-tile";
import { type AgentFlowNode, AgentNode, type AgentNodeData } from "@/components/builder/agent-node";
import { NodeInspector, type Validation, ValidationStrip } from "@/components/builder/inspector";
import { LoopEdge } from "@/components/builder/loop-edge";
import { RunTape } from "@/components/charts/run-tape";
import { RunDialog } from "@/components/run-dialog";
import { useCrumb } from "@/components/shell/top-bar";
import { Button } from "@/components/ui/button";
import { Kbd, StatusPill } from "@/components/ui/pill";
import { ErrorNote, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { post, put, get } from "@/lib/api";
import { fmtDuration } from "@/lib/format";
import type { AgentType, Graph, NodeData, RunSummary, Workflow } from "@/lib/types";
import { useRun } from "@/lib/use-run";

const nodeTypes = { research: AgentNode, analyst: AgentNode, execution: AgentNode, reviewer: AgentNode };
const edgeTypes = { loop: LoopEdge };

export default function BuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["workflow", id], queryFn: () => get<Workflow>(`/workflows/${id}`) });
  const setCrumb = useCrumb((s) => s.set);
  useEffect(() => {
    setCrumb(data?.name ?? null);
    return () => setCrumb(null);
  }, [data?.name, setCrumb]);

  if (error) {
    return (
      <div className="p-8">
        <ErrorNote error={error} onRetry={() => refetch()} />
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="flex h-[calc(100dvh-48px)] gap-3 p-2">
        <Skeleton className="h-full w-[232px]" />
        <Skeleton className="h-full flex-1" />
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <Builder workflow={data} />
    </ReactFlowProvider>
  );
}

function toFlow(graph: Graph): { nodes: AgentFlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { ...n.data, agentType: n.type },
    })),
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } })),
  };
}

function toGraph(nodes: AgentFlowNode[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map((n) => {
      const { agentType, live, stream, ...data } = n.data;
      void live;
      void stream;
      return { id: n.id, type: agentType, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: data as NodeData };
    }),
    edges: edges.filter((e) => !e.id.startsWith("loop-")).map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function nextId(type: AgentType, nodes: AgentFlowNode[]) {
  let i = 1;
  const taken = new Set(nodes.map((n) => n.id));
  while (taken.has(i === 1 ? type : `${type}_${i}`)) i++;
  return i === 1 ? type : `${type}_${i}`;
}

function Builder({ workflow }: { workflow: Workflow }) {
  const qc = useQueryClient();
  const initial = useMemo(() => toFlow(workflow.graph), [workflow.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentFlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [name, setName] = useState(workflow.name);
  const [selected, setSelected] = useState<string | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [checking, setChecking] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [version, setVersion] = useState(workflow.version);
  const [runOpen, setRunOpen] = useState(false);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const structural = JSON.stringify(graph) + name;
  const lastSaved = useRef(JSON.stringify(toGraph(initial.nodes, initial.edges)) + workflow.name);

  // ── live run on the canvas ──
  const { run, nodes: liveNodes, tokens, events } = useRun(activeRun);
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => {
        const live = activeRun ? (liveNodes[n.id] ?? null) : null;
        const stream = live?.step && live.status === "running" ? tokens[live.step.id] : undefined;
        if (n.data.live === live && n.data.stream === stream) return n;
        return { ...n, data: { ...n.data, live, stream } };
      }),
    );
  }, [liveNodes, tokens, activeRun, setNodes]);

  // ── autosave (debounced) ──
  const save = useCallback(async () => {
    const snapshot = JSON.stringify(graph) + name;
    if (snapshot === lastSaved.current) return;
    setSaveState("saving");
    try {
      const wf = await put<Workflow>(`/workflows/${workflow.id}`, { name: name.trim() || "Untitled workflow", graph });
      lastSaved.current = snapshot;
      setVersion(wf.version);
      setSaveState("saved");
      qc.setQueryData(["workflow", workflow.id], wf);
      qc.invalidateQueries({ queryKey: ["workflows"] });
    } catch (e) {
      setSaveState("error");
      toast.error("Couldn't save the workflow", (e as Error).message);
    }
  }, [graph, name, workflow.id, qc]);

  useEffect(() => {
    if (structural === lastSaved.current) return;
    setSaveState("dirty");
    const t = setTimeout(save, 900);
    return () => clearTimeout(t);
  }, [structural, save]);

  // ── validation (server compiles the graph) ──
  useEffect(() => {
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        setValidation(await post<Validation>("/workflows/validate", { name: name || "x", graph }));
      } catch {
        /* keep last */
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(graph)]);

  // revision loops are implied by the reviewer, so they are drawn (dashed) but not editable
  const loopEdges: Edge[] = useMemo(() => {
    if (!validation?.valid) return [];
    return Object.entries(validation.revisable)
      .filter(([, chain]) => chain.length)
      .map(([rev, chain]) => {
        const n = nodes.find((x) => x.id === rev);
        const max = (n?.data.maxRevisions as number | undefined) ?? 2;
        if (!max) return null;
        return {
          id: `loop-${rev}`,
          source: rev,
          target: chain[0],
          type: "loop",
          selectable: false,
          deletable: false,
          focusable: false,
          label: `revise · up to ${max}`,
          className: "pointer-events-none",
        } as Edge;
      })
      .filter(Boolean) as Edge[];
  }, [validation, nodes]);

  const liveEdges = useMemo(() => {
    if (!activeRun) return edges;
    return edges.map((e) => {
      const s = liveNodes[e.source]?.status;
      const t = liveNodes[e.target]?.status;
      const cls = t === "running" && s === "succeeded" ? "running" : s === "succeeded" && t && t !== "idle" ? "done" : undefined;
      return cls === e.className ? e : { ...e, className: cls };
    });
  }, [edges, liveNodes, activeRun]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, id: `e-${c.source}-${c.target}`, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } }, es)),
    [setEdges],
  );

  const addAgent = useCallback(
    (type: AgentType, at?: { x: number; y: number }) => {
      setNodes((ns) => {
        const id = nextId(type, ns);
        let position = at;
        if (!position && ns.length) {
          // continue the chain: to the right of the rightmost agent, on its row
          const last = ns.reduce((a, b) => (b.position.x > a.position.x ? b : a));
          position = { x: last.position.x + 320, y: last.position.y };
          setTimeout(() => fitView({ padding: 0.3, duration: 300, maxZoom: 1 }), 30);
        } else if (!position) {
          const rect = wrapper.current?.getBoundingClientRect();
          position = screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 124, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 - 50 });
        }
        setSelected(id);
        return [...ns.map((n) => ({ ...n, selected: false })), { id, type, position, selected: true, data: { label: AGENTS[type].label, agentType: type } }];
      });
    },
    [setNodes, screenToFlowPosition, fitView],
  );

  // keyboard: 1-4 add agents, ⌘S save, ⌘↵ run
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        setRunOpen(true);
      } else if (!typing && !e.metaKey && !e.ctrlKey && ["1", "2", "3", "4"].includes(e.key)) {
        addAgent(AGENT_ORDER[Number(e.key) - 1]);
      } else if (e.key === "Escape" && !typing) {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, addAgent]);

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const labels = Object.fromEntries(nodes.map((n) => [n.id, n.data.label || AGENTS[n.data.agentType].label]));
  const runActive = run && ["queued", "running", "awaiting_approval"].includes(run.status);

  const startRun = async () => {
    await save();
    setRunOpen(true);
  };

  const cancelRun = async () => {
    if (!activeRun) return;
    try {
      await post(`/runs/${activeRun}/cancel`);
    } catch (e) {
      toast.error("Couldn't cancel", (e as Error).message);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-48px)] flex-col">
      {/* builder bar */}
      <div className="flex h-11 flex-none items-center gap-3 px-3 md:px-4">
        <Link href="/app/workflows" aria-label="Back to workflows" className="rounded-full p-1.5 text-muted hover:bg-raised hover:text-text">
          <ArrowLeft className="size-4" />
        </Link>
        <input
          aria-label="Workflow name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="min-w-0 max-w-[340px] flex-1 rounded-[6px] bg-transparent px-1.5 py-1 text-[16px] font-semibold outline-none transition-colors hover:bg-raised focus:bg-raised"
        />
        <span className="num hidden text-[12px] text-muted sm:inline">v{version}</span>
        <SaveStamp state={saveState} />
        <div className="ml-auto flex items-center gap-2">
          {runActive ? (
            <Button variant="secondary" icon={<Square className="size-3" />} onClick={cancelRun}>
              Stop
            </Button>
          ) : null}
          <Button
            variant="primary"
            icon={<Play className="size-3.5" />}
            onClick={startRun}
            disabled={!validation?.valid}
            title={validation?.valid ? "Run (⌘↵)" : "Fix the problems shown on the canvas first"}
          >
            Run
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-2 pb-2">
        <Palette onAdd={addAgent} />
        <div ref={wrapper} className="relative min-w-0 flex-1 overflow-hidden rounded-[12px] border border-border bg-well">
          <ReactFlow<AgentFlowNode, Edge>
            nodes={nodes}
            edges={[...liveEdges, ...loopEdges]}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sel }) => setSelected(sel.length === 1 ? sel[0].id : null)}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const type = e.dataTransfer.getData("application/nexus-agent") as AgentType;
              if (!type) return;
              const p = screenToFlowPosition({ x: e.clientX - 124, y: e.clientY - 30 });
              addAgent(type, p);
            }}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.3}
            maxZoom={1.6}
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Controls position="bottom-left" showInteractive={false} className="glass !rounded-[10px] !shadow-none [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:!text-muted [&_button:hover]:!text-text [&_svg]:!fill-current" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              className="!rounded-[10px] !border !border-border"
              maskColor="rgb(16 16 19 / 0.7)"
              nodeColor={(n) => (AGENTS[(n.data as AgentNodeData).agentType]?.hue as string) ?? "#555"}
              nodeBorderRadius={4}
              style={{ width: 160, height: 100 }}
            />
            <Panel position="top-left">
              <ValidationStrip validation={validation} checking={checking} />
            </Panel>
            {nodes.length === 0 && (
              <Panel position="top-center" className="!top-1/3">
                <div className="rounded-[10px] border border-dashed border-control px-6 py-5 text-center">
                  <p className="text-[14px] font-medium">Drag an agent here to start</p>
                  <p className="mt-1 text-[13px] text-muted">
                    Or press <Kbd>1</Kbd> Research, <Kbd>2</Kbd> Analyst, <Kbd>3</Kbd> Execution, <Kbd>4</Kbd> Reviewer.
                  </p>
                </div>
              </Panel>
            )}
          </ReactFlow>

          {/* inspector: floating layer over the canvas */}
          <AnimatePresence>
            {selectedNode && (
              <motion.aside
                key={selectedNode.id}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12, transition: { duration: 0.12 } }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className="glass absolute bottom-3 right-3 top-3 z-20 w-[340px] max-w-[calc(100%-24px)] overflow-hidden rounded-[12px]"
                aria-label="Agent settings"
              >
                <NodeInspector
                  id={selectedNode.id}
                  type={selectedNode.data.agentType}
                  data={selectedNode.data}
                  labels={labels}
                  revisable={validation?.revisable[selectedNode.id]}
                  onClose={() => setSelected(null)}
                  onChange={(patch) => setNodes((ns) => ns.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, ...patch } } : n)))}
                  onDelete={() => {
                    setNodes((ns) => ns.filter((n) => n.id !== selectedNode.id));
                    setEdges((es) => es.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                    setSelected(null);
                  }}
                />
              </motion.aside>
            )}
          </AnimatePresence>

          {/* live run drawer */}
          <AnimatePresence>
            {run && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className={clsx("glass absolute bottom-3 left-[64px] z-10 rounded-[12px] p-4", selectedNode ? "right-[356px]" : "right-[184px]")}
              >
                <div className="mb-3 flex items-center gap-3">
                  <StatusPill status={run.status} />
                  <p className="min-w-0 flex-1 truncate text-[13px] text-muted">
                    <span className="text-text">{run.input.task}</span>
                  </p>
                  <span className="num text-[12px] text-muted">{fmtDuration(run.duration_ms ?? (run.started_at ? Date.now() - +new Date(run.started_at) : null))}</span>
                  <Link href={`/app/runs/${run.id}`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
                    Open run <ArrowUpRight className="size-3.5" />
                  </Link>
                  {!runActive && (
                    <button onClick={() => setActiveRun(null)} className="text-[12px] text-muted hover:text-text">
                      Clear
                    </button>
                  )}
                </div>
                <RunTape graph={run.graph_snapshot} steps={run.steps} events={events} startedAt={run.started_at} finishedAt={run.finished_at} compact />
                {run.status === "awaiting_approval" && (
                  <p className="mt-2 text-[13px] text-[var(--pill-warning-ink)]">
                    The Execution agent is waiting for your approval.{" "}
                    <Link href={`/app/runs/${run.id}`} className="underline underline-offset-2">
                      Review the actions
                    </Link>
                  </p>
                )}
                {run.error && <p className="mt-2 text-[13px] text-[var(--pill-negative-ink)]">{run.error}</p>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <RunDialog
        open={runOpen}
        onClose={() => setRunOpen(false)}
        workflowId={workflow.id}
        onStarted={(r: RunSummary) => {
          setActiveRun(r.id);
          setSelected(null);
          setTimeout(() => fitView({ padding: 0.3, duration: 400, maxZoom: 1 }), 50);
        }}
      />
    </div>
  );
}

function SaveStamp({ state }: { state: "saved" | "dirty" | "saving" | "error" }) {
  const text = { saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Not saved" }[state];
  return (
    <span className={clsx("text-[12px]", state === "error" ? "text-[var(--pill-negative-ink)]" : "text-muted")} aria-live="polite">
      {text}
    </span>
  );
}

function Palette({ onAdd }: { onAdd: (t: AgentType) => void }) {
  return (
    <aside className="hidden w-[232px] flex-none flex-col rounded-[12px] border border-border bg-surface p-4 md:flex" aria-label="Agents">
      <p className="mb-2 text-[12px] text-muted">Agents</p>
      <ul className="flex flex-col gap-1">
        {AGENT_ORDER.map((t, i) => {
          const meta = AGENTS[t];
          return (
            <li key={t}>
              <button
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/nexus-agent", t);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onAdd(t)}
                className="group flex w-full cursor-grab items-center gap-2.5 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-raised active:cursor-grabbing"
                title={`Add ${meta.label} (${i + 1})`}
              >
                <AgentTile type={t} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{meta.label}</span>
                  <span className="block truncate text-[12px] text-muted">{meta.description}</span>
                </span>
                <GripVertical className="size-3.5 flex-none text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto flex flex-col gap-2 pt-4 text-[12px] text-muted">
        <p className="flex items-center justify-between">
          Add agent <span className="flex gap-1"><Kbd>1</Kbd><Kbd>4</Kbd></span>
        </p>
        <p className="flex items-center justify-between">
          Delete selection <Kbd>⌫</Kbd>
        </p>
        <p className="flex items-center justify-between">
          Save <Kbd>⌘S</Kbd>
        </p>
        <p className="flex items-center justify-between">
          Run <Kbd>⌘↵</Kbd>
        </p>
        <p className="mt-2 leading-[18px]">
          Connect agents left to right. A Reviewer sends work back automatically; you never draw loops.
        </p>
      </div>
    </aside>
  );
}
