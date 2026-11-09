"""Compile a validated canvas graph into a LangGraph ``StateGraph``.

Each canvas node becomes a graph node wrapped with instrumentation (lifecycle events, timeouts,
retries, token budget). Execution agents become two graph nodes, ``plan`` then ``act``, so a
human-approval ``interrupt()`` sits at the very start of ``act``: when LangGraph resumes it
re-runs ``act`` from the top, and nothing with side effects happens before the interrupt.
Reviewers get conditional edges: approve → their successors, revise → a node in their revisable
chain, capped by ``max_revisions``.
"""

import asyncio
import operator
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any, TypedDict

from langgraph.errors import GraphInterrupt
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from app.agents import team
from app.agents.base import AgentContext, AgentResult, NodeSpec, Upstream
from app.agents.llm import LLMClient, LLMNotConfigured
from app.agents.schemas import ExecutionPlan
from app.core.config import get_settings
from app.core.logging import get_logger
from app.events import envelope as ev
from app.events.emitter import RunEmitter
from app.orchestration.spec import GraphSpec
from app.tools.registry import TOOLS

log = get_logger(__name__)

CONTINUE = "__continue__"


def merge(a: dict | None, b: dict | None) -> dict:
    return {**(a or {}), **(b or {})}


def add_usage(a: dict | None, b: dict | None) -> dict:
    a, b = a or {}, b or {}
    return {"input": a.get("input", 0) + b.get("input", 0), "output": a.get("output", 0) + b.get("output", 0)}


class RunState(TypedDict, total=False):
    task: str
    outputs: Annotated[dict, merge]  # node_id -> latest output
    iterations: Annotated[dict, merge]  # node_id -> times completed
    revisions: Annotated[dict, merge]  # reviewer_id -> revisions requested so far
    feedback: Annotated[dict, merge]  # target node_id -> reviewer feedback ("" once consumed)
    routes: Annotated[dict, merge]  # reviewer_id -> target node id or CONTINUE
    pending: Annotated[dict, merge]  # execution node_id -> plan awaiting the act step
    usage: Annotated[dict, add_usage]
    trail: Annotated[list, operator.add]  # ordered record of completed steps


class NodeFailed(Exception):
    def __init__(self, node: NodeSpec, message: str):
        super().__init__(f"{node.label}: {message}")
        self.node = node


class BudgetExceeded(Exception):
    pass


@dataclass
class Runtime:
    run_id: uuid.UUID
    workspace_id: uuid.UUID
    emitter: RunEmitter
    llm: LLMClient


def _summary(text: str, n: int = 280) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


class Compiler:
    def __init__(self, spec: GraphSpec, rt: Runtime) -> None:
        self.spec = spec
        self.rt = rt
        self.settings = get_settings()

    # -- context ---------------------------------------------------------------------------

    def _upstream(self, state: RunState, node_id: str) -> list[Upstream]:
        outputs = state.get("outputs") or {}
        return [
            Upstream(a, self.spec.nodes[a].label, self.spec.nodes[a].type, outputs[a])
            for a in self.spec.ancestors(node_id)
            if a in outputs
        ]

    def _ctx(self, state: RunState, node: NodeSpec, step_id: uuid.UUID) -> AgentContext:
        rt = self.rt

        async def emit_tool(tool: str, args: dict, result: dict | None, error: str | None) -> None:
            await rt.emitter.emit(
                ev.TOOL_CALLED,
                {
                    "node_id": node.id,
                    "tool": tool,
                    "args": args,
                    "result": result,
                    "error": error,
                    "destructive": bool(TOOLS.get(tool) and TOOLS[tool].destructive),
                },
                step_id,
            )

        async def emit_token(text: str) -> None:
            await rt.emitter.token(node.id, step_id, text)

        fb = (state.get("feedback") or {}).get(node.id) or None
        return AgentContext(
            run_id=rt.run_id,
            workspace_id=rt.workspace_id,
            node=node,
            task=state.get("task", ""),
            upstream=self._upstream(state, node.id),
            llm=rt.llm,
            emit_tool=emit_tool,
            emit_token=emit_token,
            previous=(state.get("outputs") or {}).get(node.id),
            feedback=fb,
            revise_candidates=[(n, self.spec.nodes[n].label) for n in self.spec.revisable.get(node.id, [])],
        )

    def _check_budget(self, state: RunState) -> None:
        u = state.get("usage") or {}
        used = u.get("input", 0) + u.get("output", 0)
        if used > self.settings.run_token_budget:
            raise BudgetExceeded(f"Token budget of {self.settings.run_token_budget:,} exceeded ({used:,} used).")

    def _input_summary(self, state: RunState, node: NodeSpec) -> str:
        up = self._upstream(state, node.id)
        parts = [f"Task: {_summary(state.get('task', ''), 160)}"]
        if up:
            parts.append("Builds on: " + ", ".join(u.label for u in up))
        if (state.get("feedback") or {}).get(node.id):
            parts.append("Revision requested by reviewer")
        return " · ".join(parts)

    # -- instrumentation --------------------------------------------------------------------

    async def _run_step(
        self,
        state: RunState,
        node: NodeSpec,
        iteration: int,
        fn: Callable[[AgentContext], Awaitable[Any]],
        *,
        complete: bool = True,
    ) -> tuple[Any, uuid.UUID, str]:
        """Run ``fn`` with lifecycle events, a timeout and bounded retries."""
        s = self.settings
        self._check_budget(state)
        last: Exception | None = None
        for attempt in range(1, s.node_max_attempts + 1):
            step_id = uuid.uuid4()
            started_at = datetime.now(UTC).isoformat()
            await self.rt.emitter.emit(
                ev.AGENT_STARTED,
                {
                    "node_id": node.id,
                    "agent_type": node.type,
                    "label": node.label,
                    "iteration": iteration,
                    "attempt": attempt,
                    "input_summary": self._input_summary(state, node),
                },
                step_id,
            )
            t0 = time.monotonic()
            try:
                result = await asyncio.wait_for(fn(self._ctx(state, node, step_id)), timeout=s.node_timeout_seconds)
            except (GraphInterrupt, asyncio.CancelledError):
                raise
            except LLMNotConfigured as e:
                await self._failed(node, step_id, attempt, e, will_retry=False, t0=t0)
                raise NodeFailed(node, e.message) from e
            except Exception as e:
                last = e
                will_retry = attempt < s.node_max_attempts
                await self._failed(node, step_id, attempt, e, will_retry=will_retry, t0=t0)
                if will_retry:
                    delay = min(8.0, 0.5 * 2 ** (attempt - 1))
                    await self.rt.emitter.emit(
                        ev.AGENT_RETRYING,
                        {"node_id": node.id, "label": node.label, "attempt": attempt + 1, "delay_s": delay},
                        step_id,
                    )
                    await asyncio.sleep(delay)
                    continue
                raise NodeFailed(node, _err(e)) from e

            if complete:
                ar: AgentResult = result
                await self._completed(node, step_id, ar, t0)
            return result, step_id, started_at
        raise NodeFailed(node, _err(last) if last else "failed")

    async def _failed(self, node: NodeSpec, step_id: uuid.UUID, attempt: int, e: Exception, *, will_retry: bool, t0: float) -> None:
        log.warning("agent_failed", node=node.id, attempt=attempt, error=_err(e), will_retry=will_retry)
        await self.rt.emitter.emit(
            ev.AGENT_FAILED,
            {
                "node_id": node.id,
                "label": node.label,
                "attempt": attempt,
                "error": _err(e),
                "error_type": type(e).__name__,
                "will_retry": will_retry,
                "duration_ms": int((time.monotonic() - t0) * 1000),
            },
            step_id,
        )

    async def _completed(self, node: NodeSpec, step_id: uuid.UUID, ar: AgentResult, t0: float | None, duration_ms: int | None = None) -> None:
        await self.rt.emitter.emit(
            ev.AGENT_COMPLETED,
            {
                "node_id": node.id,
                "label": node.label,
                "agent_type": node.type,
                "output": ar.output,
                "tools": ar.tools,
                "tokens_in": ar.usage.input_tokens,
                "tokens_out": ar.usage.output_tokens,
                "duration_ms": duration_ms if duration_ms is not None else int((time.monotonic() - (t0 or 0)) * 1000),
            },
            step_id,
        )

    # -- node factories --------------------------------------------------------------------

    def _agent_node(self, node: NodeSpec) -> Callable[[RunState], Awaitable[dict]]:
        runner = {"research": team.run_research, "analyst": team.run_analyst, "reviewer": team.run_reviewer}[node.type]

        async def fn(state: RunState) -> dict:
            iteration = (state.get("iterations") or {}).get(node.id, 0) + 1
            ar, _, _ = await self._run_step(state, node, iteration, runner)
            update: dict[str, Any] = {
                "outputs": {node.id: ar.output},
                "iterations": {node.id: iteration},
                "usage": {"input": ar.usage.input_tokens, "output": ar.usage.output_tokens},
                "trail": [{"node_id": node.id, "iteration": iteration}],
            }
            if (state.get("feedback") or {}).get(node.id):
                update["feedback"] = {node.id: ""}
            if node.type == "reviewer":
                update.update(await self._route_review(state, node, ar.output))
            return update

        return fn

    async def _route_review(self, state: RunState, node: NodeSpec, out: dict) -> dict:
        used = (state.get("revisions") or {}).get(node.id, 0)
        target = out.get("revise_target")
        if out.get("verdict") == "revise" and target in self.spec.revisable.get(node.id, []):
            if used < node.max_revisions:
                feedback = out.get("feedback") or "\n".join(f"- {i}" for i in out.get("issues", []))
                await self.rt.emitter.emit(
                    ev.REVIEW_REVISION,
                    {
                        "node_id": node.id,
                        "target": target,
                        "target_label": self.spec.nodes[target].label,
                        "revision": used + 1,
                        "max_revisions": node.max_revisions,
                        "feedback": feedback,
                    },
                )
                return {
                    "revisions": {node.id: used + 1},
                    "feedback": {target: feedback},
                    "routes": {node.id: target},
                }
            out["revision_cap_reached"] = True
        return {"routes": {node.id: CONTINUE}}

    def _exec_plan_node(self, node: NodeSpec) -> Callable[[RunState], Awaitable[dict]]:
        async def fn(state: RunState) -> dict:
            iteration = (state.get("iterations") or {}).get(node.id, 0) + 1
            (plan, usage), step_id, started_at = await self._run_step(
                state, node, iteration, team.plan_execution, complete=False
            )
            assert isinstance(plan, ExecutionPlan)
            update: dict[str, Any] = {
                "pending": {
                    node.id: {
                        "step_id": str(step_id),
                        "started_at": started_at,
                        "iteration": iteration,
                        "plan": plan.model_dump(),
                        "usage": {"input": usage.input_tokens, "output": usage.output_tokens},
                    }
                },
                "usage": {"input": usage.input_tokens, "output": usage.output_tokens},
            }
            if (state.get("feedback") or {}).get(node.id):
                update["feedback"] = {node.id: ""}
            return update

        return fn

    def _exec_act_node(self, node: NodeSpec) -> Callable[[RunState], Awaitable[dict]]:
        async def fn(state: RunState) -> dict:
            p = (state.get("pending") or {})[node.id]
            plan = p["plan"]
            step_id = uuid.UUID(p["step_id"])
            risky = [
                {"index": i, "tool": a["tool"], "args": team.parse_args(a.get("args_json", "")), "reason": a.get("reason", "")}
                for i, a in enumerate(plan.get("actions", []))
                if TOOLS.get(a["tool"]) and TOOLS[a["tool"]].destructive
            ]
            decisions: dict[int, bool] = {}
            if risky:
                # Execution pauses here until a person decides. Nothing above has side effects.
                answer = interrupt(
                    {"kind": "approval", "node_id": node.id, "label": node.label, "step_id": str(step_id), "actions": risky}
                )
                approved = (answer or {}).get("approved", {})
                decisions = {int(k): bool(v) for k, v in approved.items()}

            ctx = self._ctx(state, node, step_id)
            ar = await team.act_execution(ctx, plan, decisions)
            ar.usage.input_tokens = p["usage"]["input"]
            ar.usage.output_tokens = p["usage"]["output"]
            started = datetime.fromisoformat(p["started_at"])
            duration = int((datetime.now(UTC) - started).total_seconds() * 1000)
            await self._completed(node, step_id, ar, None, duration_ms=duration)
            return {
                "outputs": {node.id: ar.output},
                "iterations": {node.id: p["iteration"]},
                "trail": [{"node_id": node.id, "iteration": p["iteration"]}],
            }

        return fn

    def _router(self, node: NodeSpec) -> Callable[[RunState], list[str] | str]:
        succs = self.spec.succs[node.id]

        def route(state: RunState) -> list[str] | str:
            r = (state.get("routes") or {}).get(node.id)
            if r and r != CONTINUE:
                return [r]
            return succs or END

        return route

    # -- build ---------------------------------------------------------------------------

    def build(self) -> StateGraph:
        spec = self.spec
        g = StateGraph(RunState)
        tail: dict[str, str] = {}
        for nid in spec.order:
            node = spec.nodes[nid]
            if node.type == "execution":
                g.add_node(nid, self._exec_plan_node(node))
                g.add_node(f"{nid}__act", self._exec_act_node(node))
                g.add_edge(nid, f"{nid}__act")
                tail[nid] = f"{nid}__act"
            else:
                g.add_node(nid, self._agent_node(node))
                tail[nid] = nid

        for nid in spec.entries:
            g.add_edge(START, nid)
        for nid in spec.order:
            preds = spec.preds[nid]
            if len(preds) == 1 and spec.nodes[preds[0]].type != "reviewer":
                g.add_edge(tail[preds[0]], nid)
            elif len(preds) > 1:
                g.add_edge([tail[p] for p in preds], nid)

        for nid in spec.order:
            node = spec.nodes[nid]
            if node.type == "reviewer":
                dests = list(dict.fromkeys([*spec.revisable.get(nid, []), *spec.succs[nid]]))
                g.add_conditional_edges(tail[nid], self._router(node), [*dests, END])
            elif not spec.succs[nid]:
                g.add_edge(tail[nid], END)
        return g


def final_output(spec: GraphSpec, state: dict) -> dict[str, Any]:
    outputs = state.get("outputs") or {}
    work = [n for n in spec.order if spec.nodes[n].type != "reviewer" and n in outputs]
    reviewers = [n for n in spec.order if spec.nodes[n].type == "reviewer" and n in outputs]
    primary = work[-1] if work else (reviewers[-1] if reviewers else None)
    sources: dict[str, dict] = {}
    for n in spec.order:
        for s in (outputs.get(n) or {}).get("sources", []) or []:
            sources.setdefault(s["chunk_id"], s)
    review = outputs[reviewers[-1]] if reviewers else None
    return {
        "summary": (outputs.get(primary) or {}).get("summary", "") if primary else "",
        "primary_node": primary,
        "review": (
            {
                "verdict": review.get("verdict"),
                "score": review.get("score"),
                "issues": review.get("issues", []),
                "summary": review.get("summary", ""),
                "revision_cap_reached": review.get("revision_cap_reached", False),
            }
            if review
            else None
        ),
        "revisions": state.get("revisions") or {},
        "sources": list(sources.values()),
        "nodes": {
            n: {"label": spec.nodes[n].label, "type": spec.nodes[n].type, "summary": outputs[n].get("summary", "")}
            for n in spec.order
            if n in outputs
        },
        "usage": state.get("usage") or {},
    }


def _err(e: Exception | None) -> str:
    if e is None:
        return "unknown error"
    if isinstance(e, TimeoutError):
        return f"Timed out after {get_settings().node_timeout_seconds}s"
    msg = getattr(e, "message", None) or str(e) or type(e).__name__
    return msg[:1000]
