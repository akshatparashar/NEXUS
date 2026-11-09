import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- auth ------------------------------------------------------------------------------------


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    workspace_name: str | None = Field(default=None, max_length=80)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be empty")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(ORM):
    id: uuid.UUID
    email: str
    name: str
    created_at: datetime


class WorkspaceOut(ORM):
    id: uuid.UUID
    name: str
    slug: str
    role: str = "owner"


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class SessionOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserOut
    workspaces: list[WorkspaceOut]


# --- workflows -------------------------------------------------------------------------------


class GraphIn(BaseModel):
    nodes: list[dict[str, Any]] = Field(default_factory=list, max_length=24)
    edges: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    viewport: dict[str, Any] | None = None


class WorkflowIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    graph: GraphIn = Field(default_factory=GraphIn)


class WorkflowPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    graph: GraphIn | None = None


class WorkflowOut(ORM):
    id: uuid.UUID
    name: str
    description: str
    graph: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime


class WorkflowSummary(ORM):
    id: uuid.UUID
    name: str
    description: str
    version: int
    node_count: int = 0
    agent_types: list[str] = []
    updated_at: datetime
    last_run_status: str | None = None
    last_run_at: datetime | None = None
    run_count: int = 0


class ValidationOut(BaseModel):
    valid: bool
    problems: list[str] = []
    order: list[str] = []
    revisable: dict[str, list[str]] = {}


# --- runs ------------------------------------------------------------------------------------


class RunCreate(BaseModel):
    task: str = Field(min_length=3, max_length=8000)


class StepOut(ORM):
    id: uuid.UUID
    node_id: str
    agent_type: str
    label: str
    iteration: int
    attempt: int
    status: str
    input_summary: str
    output: dict[str, Any] | None
    error: str | None
    tools: list[Any]
    tokens_in: int
    tokens_out: int
    started_at: datetime
    finished_at: datetime | None
    duration_ms: int | None


class ApprovalOut(ORM):
    id: uuid.UUID
    run_id: uuid.UUID
    node_id: str
    actions: list[Any]
    status: str
    decision: dict[str, Any] | None
    created_at: datetime
    decided_at: datetime | None


class ArtifactOut(ORM):
    id: uuid.UUID
    node_id: str
    kind: str
    title: str
    content: str
    created_at: datetime


class RunSummary(ORM):
    id: uuid.UUID
    workflow_id: uuid.UUID
    workflow_name: str
    workflow_version: int
    status: str
    input: dict[str, Any]
    error: str | None
    queued_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    tokens_in: int
    tokens_out: int
    retry_of: uuid.UUID | None


class RunOut(RunSummary):
    graph_snapshot: dict[str, Any]
    output: dict[str, Any] | None
    steps: list[StepOut] = []
    approvals: list[ApprovalOut] = []
    artifacts: list[ArtifactOut] = []
    last_seq: int = 0


class ApprovalDecision(BaseModel):
    approve: bool
    # Optional per-action override, keyed by the action index. Missing indexes follow ``approve``.
    actions: dict[int, bool] | None = None
    note: str = Field(default="", max_length=1000)


# --- knowledge base --------------------------------------------------------------------------


class DocumentOut(ORM):
    id: uuid.UUID
    filename: str
    mime: str
    size_bytes: int
    status: str
    progress: int
    pages: int | None
    chunk_count: int
    token_count: int
    error: str | None
    created_at: datetime
    ready_at: datetime | None


class SearchIn(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    k: int = Field(default=6, ge=1, le=20)


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=4000)
    k: int = Field(default=6, ge=1, le=12)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=16000)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    use_knowledge: bool = True
