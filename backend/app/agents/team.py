"""The four NEXUS agents."""

import json
import re
from typing import Any

from app.agents import prompts
from app.agents.base import AgentContext, AgentResult, render_upstream, task_block
from app.agents.llm import Usage
from app.agents.schemas import AnalysisResult, ExecutionPlan, ResearchResult, Review, SearchPlan
from app.database.session import session_scope
from app.rag.retrieval import RetrievedChunk, format_context, hybrid_search
from app.tools.registry import TOOLS, ToolContext, ToolError, available_tools

MAX_SOURCES = 10


async def run_research(ctx: AgentContext) -> AgentResult:
    plan, u1 = await ctx.llm.structured(
        SearchPlan,
        prompts.RESEARCH_PLAN,
        task_block(ctx) + "\n\n## Upstream work\n" + render_upstream(ctx.upstream),
        temperature=0,
        model=ctx.node.model,
    )

    seen: dict[str, RetrievedChunk] = {}
    tools: list[dict[str, Any]] = []
    for query in plan.queries[:4]:
        async with session_scope() as s:
            hits = await hybrid_search(s, ctx.workspace_id, query, k=ctx.node.top_k)
        result = {
            "count": len(hits),
            "results": [{"ref": h.ref, "chunk_id": h.chunk_id, "score": h.score} for h in hits],
        }
        tools.append({"tool": "kb_search", "args": {"query": query}, "result": result, "status": "ok"})
        await ctx.emit_tool("kb_search", {"query": query}, result, None)
        for h in hits:
            if h.chunk_id not in seen or h.score > seen[h.chunk_id].score:
                seen[h.chunk_id] = h

    chunks = sorted(seen.values(), key=lambda c: c.score, reverse=True)[:MAX_SOURCES]
    user = (
        task_block(ctx)
        + "\n\n## Upstream work\n" + render_upstream(ctx.upstream)
        + "\n\n## Retrieved passages\n" + format_context(chunks)
    )
    result, u2 = await ctx.llm.structured(
        ResearchResult,
        prompts.RESEARCH,
        user,
        on_delta=ctx.emit_token,
        temperature=ctx.node.temperature,
        model=ctx.node.model,
    )
    output = result.model_dump()
    output["queries"] = plan.queries
    output["sources"] = [
        {
            "n": i,
            "chunk_id": c.chunk_id,
            "document_id": c.document_id,
            "filename": c.filename,
            "page": c.page,
            "score": c.score,
            "excerpt": c.content[:600],
        }
        for i, c in enumerate(chunks, start=1)
    ]
    output["cited"] = sorted(
        {n for f in result.findings for n in f.citations if 1 <= n <= len(chunks)}
        | {int(n) for n in re.findall(r"\[(\d+)\]", result.summary) if 1 <= int(n) <= len(chunks)}
    )
    return AgentResult(output=output, usage=u1 + u2, tools=tools)


async def run_analyst(ctx: AgentContext) -> AgentResult:
    user = task_block(ctx) + "\n\n## Upstream work\n" + render_upstream(ctx.upstream)
    result, usage = await ctx.llm.structured(
        AnalysisResult,
        prompts.ANALYST,
        user,
        on_delta=ctx.emit_token,
        temperature=ctx.node.temperature,
        model=ctx.node.model,
    )
    output = result.model_dump()
    output["sources"] = _inherited_sources(ctx)
    return AgentResult(output=output, usage=usage)


async def plan_execution(ctx: AgentContext) -> tuple[ExecutionPlan, Usage]:
    tools = available_tools(ctx.node.tools)
    system = prompts.EXECUTION + "\n\nAvailable tools:\n" + "\n".join(t.signature() for t in tools)
    user = task_block(ctx) + "\n\n## Upstream work\n" + render_upstream(ctx.upstream)
    plan, usage = await ctx.llm.structured(
        ExecutionPlan,
        system,
        user,
        on_delta=ctx.emit_token,
        temperature=ctx.node.temperature,
        model=ctx.node.model,
    )
    allowed = {t.name for t in tools}
    plan.actions = [a for a in plan.actions if a.tool in allowed][:5]
    return plan, usage


def parse_args(raw: str) -> dict[str, Any]:
    try:
        val = json.loads(raw or "{}")
        return val if isinstance(val, dict) else {"value": val}
    except json.JSONDecodeError:
        return {"_raw": raw}


async def act_execution(
    ctx: AgentContext, plan: dict[str, Any], decisions: dict[int, bool]
) -> AgentResult:
    tool_ctx = ToolContext(ctx.workspace_id, ctx.run_id, ctx.node.id)
    actions_out = []
    tools_log = []
    for i, a in enumerate(plan.get("actions", [])):
        tool = TOOLS.get(a["tool"])
        args = parse_args(a.get("args_json", "{}"))
        entry: dict[str, Any] = {"tool": a["tool"], "args": args, "reason": a.get("reason", "")}
        if tool is None:
            entry.update(status="skipped", result={"error": "unknown tool"})
        elif tool.destructive and not decisions.get(i, False):
            entry.update(status="rejected", result={"note": "Not approved by a person."})
            await ctx.emit_tool(a["tool"], args, None, "rejected by approver")
        else:
            try:
                result = await tool.run(tool_ctx, args)
                entry.update(status="done", result=result)
                await ctx.emit_tool(a["tool"], args, result, None)
            except ToolError as e:
                entry.update(status="failed", result={"error": str(e)})
                await ctx.emit_tool(a["tool"], args, None, str(e))
            except Exception as e:  # tools must never crash the run
                entry.update(status="failed", result={"error": f"{type(e).__name__}: {e}"})
                await ctx.emit_tool(a["tool"], args, None, str(e))
        entry["destructive"] = bool(tool and tool.destructive)
        actions_out.append(entry)
        tools_log.append({"tool": entry["tool"], "args": args, "result": entry["result"], "status": entry["status"]})

    done = sum(1 for a in actions_out if a["status"] == "done")
    output = {
        "summary": plan.get("summary", ""),
        "actions": actions_out,
        "completed": done,
        "total": len(actions_out),
        "sources": _inherited_sources(ctx),
    }
    return AgentResult(output=output, tools=tools_log)


async def run_reviewer(ctx: AgentContext) -> AgentResult:
    candidates = "\n".join(f"- `{nid}` ({label})" for nid, label in ctx.revise_candidates) or "(none: approve or note issues)"
    user = (
        task_block(ctx)
        + "\n\n## Work to review\n" + render_upstream(ctx.upstream)
        + "\n\n## Nodes you may send back for revision\n" + candidates
    )
    review, usage = await ctx.llm.structured(
        Review,
        prompts.REVIEWER,
        user,
        on_delta=ctx.emit_token,
        temperature=ctx.node.temperature if ctx.node.temperature is not None else 0,
        model=ctx.node.model,
    )
    valid = {nid for nid, _ in ctx.revise_candidates}
    if review.verdict == "revise":
        if not valid:
            review.verdict = "approve"
            review.issues = [*review.issues, "Revision not possible from this position in the graph."]
        elif review.revise_target not in valid:
            review.revise_target = ctx.revise_candidates[0][0]
    output = review.model_dump()
    output["sources"] = _inherited_sources(ctx)
    return AgentResult(output=output, usage=usage)


def _inherited_sources(ctx: AgentContext) -> list[dict[str, Any]]:
    seen: dict[str, dict] = {}
    for u in ctx.upstream:
        for s in u.output.get("sources", []) or []:
            seen.setdefault(s["chunk_id"], s)
    return list(seen.values())
