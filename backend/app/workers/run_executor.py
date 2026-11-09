"""Executes workflow runs. Lives in the worker process; driven by commands from Kafka.

Durability model
* Every run is a LangGraph thread (``thread_id = run_id``) checkpointed in Postgres after each step.
* A worker claims a run with a lease (``worker_id`` + ``heartbeat_at``). If a worker dies, its lease
  goes stale and any worker resumes the run from the last checkpoint.
* Approvals pause the run at an ``interrupt()``; nothing holds a worker while a person decides.
"""

import asyncio
import contextlib
import os
import socket
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from langgraph.types import Command
from sqlalchemy import and_, or_, select, update

from app.agents.llm import LLMNotConfigured, get_llm
from app.core.config import get_settings
from app.core.logging import get_logger
from app.database.session import session_scope
from app.events import envelope as ev
from app.events.emitter import RunEmitter
from app.models import Approval, RunStep, WorkflowRun
from app.orchestration.compiler import BudgetExceeded, Compiler, NodeFailed, Runtime, final_output
from app.orchestration.spec import GraphInvalid, parse_graph, recursion_limit
from app.workers.checkpointer import get_checkpointer

log = get_logger(__name__)

TERMINAL = ("succeeded", "failed", "cancelled", "timed_out")
HEARTBEAT_SECONDS = 5
WORKER_ID = f"{socket.gethostname()}-{os.getpid()}"


class RunExecutor:
    def __init__(self) -> None:
        self.tasks: dict[uuid.UUID, asyncio.Task] = {}
        self._sem = asyncio.Semaphore(get_settings().max_concurrent_runs)
        self._cancel_requested: set[uuid.UUID] = set()

    # -- public API (called by the command consumer) ----------------------------------------

    def submit(self, run_id: uuid.UUID, mode: str, resume: Any = None) -> None:
        if run_id in self.tasks and not self.tasks[run_id].done():
            log.info("run_already_active", run_id=str(run_id))
            return
        task = asyncio.create_task(self._guarded(run_id, mode, resume), name=f"run-{run_id}")
        self.tasks[run_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(run_id, None))

    async def run_now(self, run_id: uuid.UUID, mode: str, resume: Any = None) -> None:
        """Execute in the caller's task and return when the run stops (serverless consumers)."""
        await self._guarded(run_id, mode, resume)

    async def cancel(self, run_id: uuid.UUID) -> None:
        task = self.tasks.get(run_id)
        if task and not task.done():
            self._cancel_requested.add(run_id)
            task.cancel()  # _guarded turns this into a workflow.cancelled event
            return
        # Not running here (queued elsewhere or waiting for approval): cancel directly.
        await self._mark_cancelled(run_id)

    async def _mark_cancelled(self, run_id: uuid.UUID) -> None:
        async with session_scope() as s:
            run = await s.get(WorkflowRun, run_id)
            if run is None or run.status in TERMINAL:
                return
            ws = run.workspace_id
            await s.execute(update(Approval).where(Approval.run_id == run_id, Approval.status == "pending").values(status="rejected"))
        await RunEmitter(run_id, ws).emit(ev.WORKFLOW_CANCELLED, {"reason": "Cancelled by user"})
        await self._release(run_id)

    async def recover(self) -> int:
        """Resume runs whose worker died, and pick up queued runs whose command was lost."""
        s = get_settings()
        stale = datetime.now(UTC) - timedelta(seconds=s.lease_stale_seconds)
        async with session_scope() as session:
            rows = (
                await session.execute(
                    select(WorkflowRun.id).where(
                        or_(
                            and_(WorkflowRun.status == "running", or_(WorkflowRun.heartbeat_at.is_(None), WorkflowRun.heartbeat_at < stale)),
                            and_(WorkflowRun.status == "queued", WorkflowRun.queued_at < stale, WorkflowRun.worker_id.is_(None)),
                        )
                    )
                )
            ).scalars().all()
        for run_id in rows:
            log.info("run_recovering", run_id=str(run_id))
            self.submit(run_id, "recover")
        return len(rows)

    async def wait_idle(self) -> None:
        while self.tasks:
            await asyncio.gather(*list(self.tasks.values()), return_exceptions=True)

    # -- internals ----------------------------------------------------------------------------

    async def _guarded(self, run_id: uuid.UUID, mode: str, resume: Any) -> None:
        try:
            async with self._sem:
                await self._execute(run_id, mode, resume)
        except asyncio.CancelledError:
            # A user cancel can land at any point: waiting for a slot, claiming, or mid-graph.
            if run_id in self._cancel_requested:
                self._cancel_requested.discard(run_id)
                await self._mark_cancelled(run_id)
                return
            raise  # worker shutdown: keep the lease so another worker recovers the run
        except Exception:
            log.exception("run_executor_crashed", run_id=str(run_id))

    async def _claim(self, run_id: uuid.UUID) -> WorkflowRun | None:
        stale = datetime.now(UTC) - timedelta(seconds=get_settings().lease_stale_seconds)
        async with session_scope() as s:
            row = (
                await s.execute(
                    update(WorkflowRun)
                    .where(
                        WorkflowRun.id == run_id,
                        WorkflowRun.status.notin_(TERMINAL),
                        or_(
                            WorkflowRun.worker_id.is_(None),
                            WorkflowRun.worker_id == WORKER_ID,
                            WorkflowRun.heartbeat_at < stale,
                        ),
                    )
                    .values(worker_id=WORKER_ID, heartbeat_at=datetime.now(UTC))
                    .returning(WorkflowRun)
                )
            ).scalars().first()
            return row

    async def _release(self, run_id: uuid.UUID) -> None:
        async with session_scope() as s:
            await s.execute(
                update(WorkflowRun).where(WorkflowRun.id == run_id, WorkflowRun.worker_id == WORKER_ID).values(worker_id=None)
            )

    async def _heartbeat(self, run_id: uuid.UUID, owner: asyncio.Task | None) -> None:
        """Renew the lease, and stop the run if it was cancelled from another process."""
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            async with session_scope() as s:
                status = (
                    await s.execute(
                        update(WorkflowRun)
                        .where(WorkflowRun.id == run_id)
                        .values(heartbeat_at=datetime.now(UTC))
                        .returning(WorkflowRun.status)
                    )
                ).scalar_one_or_none()
            if status == "cancelled" and owner is not None:
                log.info("run_cancelled_elsewhere", run_id=str(run_id))
                self._cancel_requested.add(run_id)
                owner.cancel()
                return

    async def _execute(self, run_id: uuid.UUID, mode: str, resume: Any) -> None:
        run = await self._claim(run_id)
        if run is None:
            log.info("run_not_claimable", run_id=str(run_id), mode=mode)
            return
        if mode == "start" and run.status != "queued":
            # Duplicate delivery of the start command: the run is already underway elsewhere.
            await self._release(run_id)
            return
        if run.status == "awaiting_approval" and mode != "resume":
            await self._release(run_id)
            return

        s = get_settings()
        emitter = RunEmitter(run.id, run.workspace_id)
        try:
            spec = parse_graph(run.graph_snapshot)
            llm = get_llm()
        except (GraphInvalid, LLMNotConfigured) as e:
            await emitter.emit(ev.WORKFLOW_FAILED, {"error": str(getattr(e, "message", e)), "status": "failed"})
            await self._release(run_id)
            return

        checkpointer = await get_checkpointer()
        graph = Compiler(spec, Runtime(run.id, run.workspace_id, emitter, llm)).build().compile(checkpointer=checkpointer)
        config = {"configurable": {"thread_id": str(run.id)}, "recursion_limit": recursion_limit(spec)}

        has_checkpoint = (await checkpointer.aget_tuple(config)) is not None
        graph_input: Any
        if mode == "resume":
            graph_input = Command(resume=resume)
            await emitter.emit(ev.WORKFLOW_RESUMED, {"reason": "approval"})
        elif mode == "recover" and has_checkpoint:
            graph_input = None
            await self._close_interrupted_steps(run, emitter)
            await emitter.emit(ev.WORKFLOW_RESUMED, {"reason": "recovered from checkpoint", "worker": WORKER_ID})
        elif mode == "retry" and has_checkpoint:
            graph_input = None
            await emitter.emit(ev.WORKFLOW_RESUMED, {"reason": "retry from last checkpoint"})
        else:
            graph_input = {"task": run.input.get("task", ""), "outputs": {}, "iterations": {}, "revisions": {}}
            await emitter.emit(
                ev.WORKFLOW_STARTED,
                {
                    "workflow_id": str(run.workflow_id),
                    "workflow_name": run.workflow_name,
                    "nodes": len(spec.nodes),
                    "worker": WORKER_ID,
                    "provider": getattr(llm, "provider", "?"),
                    "model": getattr(llm, "model", "?"),
                },
            )

        hb = asyncio.create_task(self._heartbeat(run.id, asyncio.current_task()))
        try:
            async with asyncio.timeout(s.run_timeout_seconds):
                async for update_ in graph.astream(graph_input, config, stream_mode="updates"):
                    if "__interrupt__" in update_:
                        await self._pause_for_approval(run, emitter, update_["__interrupt__"])
                        return
            state = (await graph.aget_state(config)).values
            await emitter.emit(ev.WORKFLOW_COMPLETED, {"output": final_output(spec, state)})
        except TimeoutError:
            await emitter.emit(
                ev.WORKFLOW_FAILED,
                {"error": f"The run exceeded its {s.run_timeout_seconds}s time limit.", "status": "timed_out"},
            )
        except (NodeFailed, BudgetExceeded) as e:
            await emitter.emit(ev.WORKFLOW_FAILED, {"error": str(e), "status": "failed", "node_id": getattr(getattr(e, "node", None), "id", None)})
        except Exception as e:
            log.exception("run_failed", run_id=str(run.id))
            await emitter.emit(ev.WORKFLOW_FAILED, {"error": f"{type(e).__name__}: {e}"[:1000], "status": "failed"})
        finally:
            hb.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await hb
            await self._release(run.id)

    async def _close_interrupted_steps(self, run: WorkflowRun, emitter: RunEmitter) -> None:
        """Steps that were mid-flight when the previous worker died are recorded as interrupted."""
        async with session_scope() as s:
            steps = (
                await s.execute(select(RunStep).where(RunStep.run_id == run.id, RunStep.status == "running"))
            ).scalars().all()
        for st in steps:
            await emitter.emit(
                ev.AGENT_FAILED,
                {
                    "node_id": st.node_id,
                    "label": st.label,
                    "attempt": st.attempt,
                    "error": "Interrupted when the worker stopped. Resuming from the last checkpoint.",
                    "error_type": "WorkerInterrupted",
                    "will_retry": True,
                },
                st.id,
            )

    async def _pause_for_approval(self, run: WorkflowRun, emitter: RunEmitter, interrupts: Any) -> None:
        for intr in interrupts:
            value = getattr(intr, "value", intr)
            async with session_scope() as s:
                approval = Approval(
                    run_id=run.id,
                    workspace_id=run.workspace_id,
                    node_id=value["node_id"],
                    actions=value["actions"],
                    status="pending",
                )
                s.add(approval)
                await s.flush()
                approval_id = approval.id
            await emitter.emit(
                ev.APPROVAL_REQUIRED,
                {
                    "approval_id": str(approval_id),
                    "node_id": value["node_id"],
                    "label": value.get("label"),
                    "actions": value["actions"],
                },
                uuid.UUID(value["step_id"]),
            )
