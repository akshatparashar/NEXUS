"""Parse and validate the canvas graph the Workflow Builder saves.

Canvas JSON (React Flow shape, trimmed):

    {"nodes": [{"id": "n1", "type": "research", "position": {...}, "data": {"label": "...", ...}}],
     "edges": [{"id": "e1", "source": "n1", "target": "n2"}]}

Rules:
* drawn edges must form a DAG. Revision loops are not drawn: a Reviewer sends work back to one of
  the nodes in its "revisable chain" (see below) at most ``max_revisions`` times;
* a node with several incoming edges is a join and waits for all of them;
* a Reviewer may not feed a join (its conditional routing would leave the join waiting forever).
"""

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from app.agents.base import AGENT_LABELS, AGENT_TYPES, NodeSpec
from app.core.config import get_settings

MAX_NODES = 24


@dataclass
class GraphSpec:
    nodes: dict[str, NodeSpec]
    preds: dict[str, list[str]]
    succs: dict[str, list[str]]
    order: list[str]  # topological order
    revisable: dict[str, list[str]] = field(default_factory=dict)  # reviewer -> candidate targets

    @property
    def entries(self) -> list[str]:
        return [n for n in self.order if not self.preds[n]]

    @property
    def exits(self) -> list[str]:
        return [n for n in self.order if not self.succs[n]]

    def ancestors(self, node_id: str) -> list[str]:
        seen: list[str] = []
        stack = list(self.preds[node_id])
        while stack:
            p = stack.pop()
            if p not in seen:
                seen.append(p)
                stack.extend(self.preds[p])
        return [n for n in self.order if n in seen]


class GraphInvalid(ValueError):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def _num(v: Any, default: float | None, lo: float, hi: float) -> float | None:
    if v is None or v == "":
        return default
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def parse_graph(graph: dict[str, Any]) -> GraphSpec:
    s = get_settings()
    problems: list[str] = []
    raw_nodes = graph.get("nodes") or []
    raw_edges = graph.get("edges") or []
    if not raw_nodes:
        raise GraphInvalid(["Add at least one agent to the canvas."])
    if len(raw_nodes) > MAX_NODES:
        raise GraphInvalid([f"A workflow can have at most {MAX_NODES} agents."])

    nodes: dict[str, NodeSpec] = {}
    for n in raw_nodes:
        nid = str(n.get("id", "")).strip()
        ntype = n.get("type") or (n.get("data") or {}).get("agentType")
        data = n.get("data") or {}
        if not nid:
            problems.append("A node is missing its id.")
            continue
        if nid in nodes:
            problems.append(f"Duplicate node id {nid}.")
            continue
        if ntype not in AGENT_TYPES:
            problems.append(f"Node {nid} has unknown agent type {ntype!r}.")
            continue
        tools = data.get("tools")
        nodes[nid] = NodeSpec(
            id=nid,
            type=ntype,
            label=str(data.get("label") or AGENT_LABELS[ntype])[:80],
            instructions=str(data.get("instructions") or "")[:4000],
            temperature=_num(data.get("temperature"), None, 0, 1.5),
            model=(str(data["model"]).strip() or None) if data.get("model") else None,
            tools=[str(t) for t in tools] if isinstance(tools, list) and tools else None,
            max_revisions=int(_num(data.get("maxRevisions"), s.default_max_revisions, 0, s.hard_max_revisions) or 0),
            top_k=int(_num(data.get("topK"), 6, 1, 12) or 6),
        )

    preds: dict[str, list[str]] = defaultdict(list)
    succs: dict[str, list[str]] = defaultdict(list)
    for e in raw_edges:
        a, b = str(e.get("source", "")), str(e.get("target", ""))
        if a not in nodes or b not in nodes:
            problems.append(f"Edge {e.get('id', '?')} points at a node that does not exist.")
            continue
        if a == b:
            problems.append(f"{nodes[a].label} cannot connect to itself.")
            continue
        if b in succs[a]:
            continue
        succs[a].append(b)
        preds[b].append(a)
    for nid in nodes:
        preds.setdefault(nid, [])
        succs.setdefault(nid, [])

    if problems:
        raise GraphInvalid(problems)

    # Kahn's algorithm: topological order + cycle detection
    indeg = {n: len(preds[n]) for n in nodes}
    queue = [n for n in nodes if indeg[n] == 0]
    order: list[str] = []
    while queue:
        n = queue.pop(0)
        order.append(n)
        for m in succs[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                queue.append(m)
    if len(order) != len(nodes):
        stuck = [nodes[n].label for n in nodes if n not in order]
        raise GraphInvalid([
            f"The connections form a loop ({', '.join(stuck)}). Loops come from a Reviewer's revisions, "
            "so remove the backward connection."
        ])

    if len(nodes) > 1:
        isolated = [nodes[n].label for n in nodes if not preds[n] and not succs[n]]
        if isolated:
            problems.append(f"Connect or remove: {', '.join(isolated)}.")

    revisable: dict[str, list[str]] = {}
    for nid, spec in nodes.items():
        if spec.type != "reviewer":
            continue
        for succ in succs[nid]:
            if len(preds[succ]) > 1:
                problems.append(
                    f"{spec.label} feeds {nodes[succ].label}, which waits on several inputs. "
                    "Place the Reviewer after the join instead."
                )
        # A node is a valid revision target when re-running it re-triggers this reviewer without
        # passing through a join (a join would wait for inputs that never re-fire). Walk back the
        # single-predecessor chain; a join itself may be targeted directly, but nothing before it.
        chain: list[str] = []
        if len(preds[nid]) == 1:
            cur = preds[nid][0]
            while nodes[cur].type != "reviewer":
                chain.append(cur)
                if len(preds[cur]) != 1:
                    break
                cur = preds[cur][0]
        revisable[nid] = chain

    if problems:
        raise GraphInvalid(problems)
    return GraphSpec(nodes=nodes, preds=dict(preds), succs=dict(succs), order=order, revisable=revisable)


def recursion_limit(spec: GraphSpec) -> int:
    reviews = sum(n.max_revisions for n in spec.nodes.values() if n.type == "reviewer")
    return max(25, (len(spec.nodes) * 2 + 2) * (reviews + 1) + 10)
