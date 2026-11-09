import uuid

from fastapi import APIRouter, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import distinct_on

from app.core.deps import CurrentUser, CurrentWorkspace, SessionDep, rate_limit
from app.core.errors import NotFound
from app.models import Workflow, WorkflowRun, utcnow
from app.orchestration.spec import GraphInvalid, parse_graph
from app.schemas import (
    RunCreate,
    RunSummary,
    ValidationOut,
    WorkflowIn,
    WorkflowOut,
    WorkflowPatch,
    WorkflowSummary,
)
from app.services import run_service

router = APIRouter(prefix="/workflows", tags=["workflows"])


async def _get(session: SessionDep, ws: CurrentWorkspace, workflow_id: uuid.UUID) -> Workflow:
    wf = (
        await session.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.workspace_id == ws.id))
    ).scalars().first()
    if wf is None:
        raise NotFound("Workflow not found.")
    return wf


@router.get("", response_model=list[WorkflowSummary])
async def list_workflows(session: SessionDep, ws: CurrentWorkspace) -> list[WorkflowSummary]:
    last = (
        select(
            WorkflowRun.workflow_id,
            func.count().label("n"),
            func.max(WorkflowRun.queued_at).label("last_at"),
        )
        .where(WorkflowRun.workspace_id == ws.id)
        .group_by(WorkflowRun.workflow_id)
        .subquery()
    )
    rows = (
        await session.execute(
            select(Workflow, last.c.n, last.c.last_at)
            .outerjoin(last, last.c.workflow_id == Workflow.id)
            .where(Workflow.workspace_id == ws.id)
            .order_by(Workflow.updated_at.desc())
        )
    ).all()
    status_rows = (
        await session.execute(
            select(WorkflowRun.workflow_id, WorkflowRun.status)
            .ext(distinct_on(WorkflowRun.workflow_id))
            .where(WorkflowRun.workspace_id == ws.id)
            .order_by(WorkflowRun.workflow_id, WorkflowRun.queued_at.desc())
        )
    ).all()
    last_status = dict(status_rows)
    out = []
    for wf, n, last_at in rows:
        nodes = (wf.graph or {}).get("nodes", [])
        out.append(
            WorkflowSummary(
                id=wf.id,
                name=wf.name,
                description=wf.description,
                version=wf.version,
                node_count=len(nodes),
                agent_types=[n.get("type", "") for n in nodes],
                updated_at=wf.updated_at,
                last_run_status=last_status.get(wf.id),
                last_run_at=last_at,
                run_count=n or 0,
            )
        )
    return out


@router.post("", response_model=WorkflowOut, status_code=status.HTTP_201_CREATED)
async def create_workflow(body: WorkflowIn, session: SessionDep, ws: CurrentWorkspace, user: CurrentUser) -> Workflow:
    wf = Workflow(
        workspace_id=ws.id,
        name=body.name.strip(),
        description=body.description,
        graph=body.graph.model_dump(),
        created_by=user.id,
    )
    session.add(wf)
    await session.commit()
    return wf


@router.get("/{workflow_id}", response_model=WorkflowOut)
async def get_workflow(workflow_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace) -> Workflow:
    return await _get(session, ws, workflow_id)


@router.put("/{workflow_id}", response_model=WorkflowOut)
async def update_workflow(workflow_id: uuid.UUID, body: WorkflowPatch, session: SessionDep, ws: CurrentWorkspace) -> Workflow:
    wf = await _get(session, ws, workflow_id)
    if body.name is not None:
        wf.name = body.name.strip()
    if body.description is not None:
        wf.description = body.description
    if body.graph is not None:
        new_graph = body.graph.model_dump()
        if _structural(new_graph) != _structural(wf.graph):
            wf.version += 1
        wf.graph = new_graph
    wf.updated_at = utcnow()
    await session.commit()
    return wf


def _structural(graph: dict) -> tuple:
    """What changes the run (nodes, config, edges); moving nodes around does not bump the version."""
    nodes = tuple(sorted((n.get("id"), n.get("type"), repr(sorted((n.get("data") or {}).items()))) for n in graph.get("nodes", [])))
    edges = tuple(sorted((e.get("source"), e.get("target")) for e in graph.get("edges", [])))
    return nodes, edges


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(workflow_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace) -> None:
    wf = await _get(session, ws, workflow_id)
    await session.delete(wf)
    await session.commit()


@router.post("/{workflow_id}/duplicate", response_model=WorkflowOut, status_code=status.HTTP_201_CREATED)
async def duplicate_workflow(workflow_id: uuid.UUID, session: SessionDep, ws: CurrentWorkspace, user: CurrentUser) -> Workflow:
    wf = await _get(session, ws, workflow_id)
    copy = Workflow(
        workspace_id=ws.id, name=f"{wf.name} (copy)"[:120], description=wf.description, graph=wf.graph, created_by=user.id
    )
    session.add(copy)
    await session.commit()
    return copy


@router.post("/validate", response_model=ValidationOut)
async def validate_graph(body: WorkflowIn) -> ValidationOut:
    try:
        spec = parse_graph(body.graph.model_dump())
    except GraphInvalid as e:
        return ValidationOut(valid=False, problems=e.problems)
    return ValidationOut(valid=True, order=spec.order, revisable=spec.revisable)


@router.post(
    "/{workflow_id}/runs",
    response_model=RunSummary,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[rate_limit("runs", "rate_limit_runs")],
)
async def start_run(
    workflow_id: uuid.UUID, body: RunCreate, session: SessionDep, ws: CurrentWorkspace, user: CurrentUser
) -> WorkflowRun:
    wf = await _get(session, ws, workflow_id)
    return await run_service.create_run(session, ws, user, wf, body.task)
