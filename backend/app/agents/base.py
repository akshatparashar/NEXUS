import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from app.agents.llm import LLMClient, Usage

AGENT_TYPES = ("research", "analyst", "execution", "reviewer")
AGENT_LABELS = {
    "research": "Research",
    "analyst": "Analyst",
    "execution": "Execution",
    "reviewer": "Reviewer",
}


@dataclass
class NodeSpec:
    id: str
    type: str
    label: str
    instructions: str = ""
    temperature: float | None = None
    model: str | None = None
    tools: list[str] | None = None
    max_revisions: int = 2
    top_k: int = 6


@dataclass
class Upstream:
    node_id: str
    label: str
    type: str
    output: dict[str, Any]


ToolEmitter = Callable[[str, dict[str, Any], dict[str, Any] | None, str | None], Awaitable[None]]
TokenEmitter = Callable[[str], Awaitable[None]]


@dataclass
class AgentContext:
    run_id: uuid.UUID
    workspace_id: uuid.UUID
    node: NodeSpec
    task: str
    upstream: list[Upstream]
    llm: LLMClient
    emit_tool: ToolEmitter
    emit_token: TokenEmitter
    previous: dict[str, Any] | None = None
    feedback: str | None = None
    revise_candidates: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class AgentResult:
    output: dict[str, Any]
    usage: Usage = field(default_factory=Usage)
    tools: list[dict[str, Any]] = field(default_factory=list)


def render_upstream(upstream: list[Upstream]) -> str:
    if not upstream:
        return "(No upstream work. You are the first agent.)"
    parts = []
    for u in upstream:
        o = u.output
        lines = [f"### {u.label} — {u.type} agent (node `{u.node_id}`)", o.get("summary", "").strip()]
        if o.get("findings"):
            lines.append("Findings:\n" + "\n".join(
                f"- {f['claim']} {''.join(f'[{c}]' for c in f.get('citations', []))}" for f in o["findings"]
            ))
        if o.get("insights"):
            lines.append("Insights:\n" + "\n".join(f"- **{i['title']}** {i['detail']}" for i in o["insights"]))
        if o.get("gaps"):
            lines.append("Gaps:\n" + "\n".join(f"- {g}" for g in o["gaps"]))
        if o.get("actions"):
            lines.append("Actions:\n" + "\n".join(
                f"- {a['tool']} → {a.get('status', 'planned')}" for a in o["actions"]
            ))
        if o.get("sources"):
            lines.append("Sources:\n" + "\n".join(
                f"[{s['n']}] {s['filename']}{f', p.{s['page']}' if s.get('page') else ''}" for s in o["sources"]
            ))
        parts.append("\n".join(x for x in lines if x))
    return "\n\n".join(parts)


def task_block(ctx: AgentContext) -> str:
    out = [f"## Task\n{ctx.task.strip()}"]
    if ctx.node.instructions.strip():
        out.append(f"## Instructions for you\n{ctx.node.instructions.strip()}")
    if ctx.feedback:
        out.append(
            "## Revision requested by the reviewer\n"
            f"{ctx.feedback.strip()}\nAddress every point. Keep what was already good."
        )
        if ctx.previous and ctx.previous.get("summary"):
            out.append(f"## Your previous output\n{ctx.previous['summary']}")
    return "\n\n".join(out)
