import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field

# Topics
COMMANDS = "nexus.commands"
LIFECYCLE = "nexus.lifecycle"
DLQ = "nexus.dlq"
ALL_TOPICS = (COMMANDS, LIFECYCLE, DLQ)

# Command types (consumed by the worker)
RUN_REQUESTED = "workflow.run.requested"
RUN_RESUME = "workflow.run.resume"
RUN_CANCEL = "workflow.run.cancel"
DOCUMENT_UPLOADED = "document.uploaded"

# Lifecycle types (consumed by the projector)
WORKFLOW_STARTED = "workflow.started"
WORKFLOW_RESUMED = "workflow.resumed"
WORKFLOW_COMPLETED = "workflow.completed"
WORKFLOW_FAILED = "workflow.failed"
WORKFLOW_CANCELLED = "workflow.cancelled"
AGENT_STARTED = "agent.started"
AGENT_COMPLETED = "agent.completed"
AGENT_FAILED = "agent.failed"
AGENT_RETRYING = "agent.retrying"
TOOL_CALLED = "tool.called"
REVIEW_REVISION = "review.revision_requested"
APPROVAL_REQUIRED = "approval.required"
APPROVAL_RESOLVED = "approval.resolved"
DOCUMENT_STATUS = "document.status"

# Ephemeral realtime-only type (never persisted, never on Kafka)
AGENT_TOKEN = "agent.token"


class EventEnvelope(BaseModel):
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    type: str
    version: int = 1
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    workspace_id: uuid.UUID
    run_id: uuid.UUID | None = None
    step_id: uuid.UUID | None = None
    seq: int | None = None
    payload: dict[str, Any] = Field(default_factory=dict)

    @property
    def key(self) -> str:
        """Partition key: everything about one run lands on one partition, in order."""
        return str(self.run_id or self.payload.get("document_id") or self.workspace_id)

    def to_bytes(self) -> bytes:
        return self.model_dump_json().encode()

    @classmethod
    def from_bytes(cls, raw: bytes) -> "EventEnvelope":
        return cls.model_validate_json(raw)
