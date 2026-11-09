"""Structured outputs. Field order matters: ``summary`` comes first so it streams first."""

from typing import Literal

from pydantic import BaseModel, Field


class SearchPlan(BaseModel):
    """Plan the knowledge-base searches needed to research the task."""

    rationale: str = Field(description="One or two sentences on what information is needed and why.")
    queries: list[str] = Field(
        description="Between 1 and 4 short, distinct search queries for the knowledge base.",
        min_length=1,
        max_length=4,
    )


class Finding(BaseModel):
    claim: str = Field(description="One factual statement supported by the sources.")
    citations: list[int] = Field(default_factory=list, description="Source numbers [n] that support the claim.")


class ResearchResult(BaseModel):
    """Report the research findings, grounded in the numbered sources."""

    summary: str = Field(
        description="Markdown research brief (120-250 words). Cite sources inline as [n]. "
        "If the sources do not cover something, say so plainly."
    )
    findings: list[Finding] = Field(description="3 to 8 key findings, each with citations.")
    open_questions: list[str] = Field(default_factory=list, description="What the sources could not answer.")


class Insight(BaseModel):
    title: str = Field(description="A short headline for the insight.")
    detail: str = Field(description="Two or three sentences explaining the insight and its implication.")


class AnalysisResult(BaseModel):
    """Report the analysis of the upstream work."""

    summary: str = Field(description="Markdown analytical summary (120-250 words). Keep [n] citations you rely on.")
    insights: list[Insight] = Field(description="2 to 6 insights: patterns, trade-offs, implications.")
    gaps: list[str] = Field(default_factory=list, description="Missing information or weak evidence.")
    risks: list[str] = Field(default_factory=list, description="Risks or caveats a decision-maker should know.")
    confidence: float = Field(ge=0, le=1, description="Confidence in the analysis, 0 to 1.")


class PlannedAction(BaseModel):
    tool: str = Field(description="Exact tool name from the list of available tools.")
    args_json: str = Field(description='Arguments as a JSON object string, e.g. {"query": "pricing"}.')
    reason: str = Field(description="Why this action moves the task forward.")


class ExecutionPlan(BaseModel):
    """Plan the concrete actions to carry out with the available tools."""

    summary: str = Field(description="Markdown description (60-150 words) of what you will do and why.")
    actions: list[PlannedAction] = Field(
        default_factory=list, description="0 to 5 actions, in order. Use only the listed tools."
    )


class Review(BaseModel):
    """Review the work of the other agents."""

    summary: str = Field(description="Markdown review (80-200 words): what is strong, what is missing.")
    verdict: Literal["approve", "revise"] = Field(
        description="approve if the work answers the task completely and consistently; revise otherwise."
    )
    score: int = Field(ge=1, le=10, description="Overall quality from 1 to 10.")
    issues: list[str] = Field(default_factory=list, description="Specific, fixable problems.")
    revise_target: str | None = Field(
        default=None, description="When verdict is revise: the node id that should redo its work."
    )
    feedback: str = Field(default="", description="When verdict is revise: concrete instructions for that agent.")
