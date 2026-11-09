"""Test doubles. These exist only in tests; the application always calls a real model."""

import asyncio
import hashlib
import math
import re
from collections import deque
from typing import Any

from pydantic import BaseModel

from app.agents.llm import LLMClient, TransientLLMError, Usage
from app.agents.schemas import (
    AnalysisResult,
    ExecutionPlan,
    PlannedAction,
    ResearchResult,
    Review,
    SearchPlan,
)
from app.rag.embeddings import Embedder


class HashEmbedder(Embedder):
    """Deterministic bag-of-words embedding: texts sharing words are close in cosine space."""

    dim = 384

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        for w in re.findall(r"[a-z0-9]+", text.lower()):
            if len(w) < 3:
                continue
            h = int(hashlib.md5(w.encode()).hexdigest(), 16)
            v[h % self.dim] += 1.0
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]


class ScriptedLLM(LLMClient):
    """Returns schema-valid outputs derived from the prompt, so the whole pipeline runs for real."""

    provider = "scripted"
    model = "scripted-test-model"

    def __init__(self) -> None:
        self.verdicts: deque[str] = deque()
        self.exec_actions: list[PlannedAction] = []
        self.fail_next: int = 0  # raise a transient error this many times
        self.delay: float = 0.0  # seconds per call, to hold runs open
        self.calls: list[tuple[str, str]] = []

    def reset(self) -> None:
        self.__init__()

    async def _maybe_fail(self) -> None:
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail_next > 0:
            self.fail_next -= 1
            raise TransientLLMError("RateLimitError: simulated 429")

    async def structured(self, schema: type[BaseModel], system: str, user: str, *, on_delta=None, stream_field="summary", temperature=None, model=None):
        await self._maybe_fail()
        self.calls.append((schema.__name__, user))
        has_sources = "[1] (" in user
        out: BaseModel
        if schema is SearchPlan:
            task = user.split("## Task\n", 1)[-1].split("\n", 1)[0]
            words = [w for w in re.findall(r"[A-Za-z]{4,}", task)][:6]
            out = SearchPlan(rationale="Look up the key terms.", queries=[" ".join(words) or task[:50]])
        elif schema is ResearchResult:
            cite = " [1]" if has_sources else ""
            summary = f"The sources describe the topic in detail{cite}. Key facts are listed below."
            out = ResearchResult(
                summary=summary,
                findings=[{"claim": "A grounded fact from the passages.", "citations": [1] if has_sources else []}],
                open_questions=[] if has_sources else ["The knowledge base has nothing on this."],
            )
        elif schema is AnalysisResult:
            revised = "Revision requested" in user
            out = AnalysisResult(
                summary=("Revised analysis. " if revised else "") + "The research shows a clear pattern [1].",
                insights=[{"title": "Pattern", "detail": "Something consistent appears across sources."}],
                gaps=[],
                risks=[],
                confidence=0.8,
            )
        elif schema is ExecutionPlan:
            out = ExecutionPlan(summary="I will act on the findings.", actions=list(self.exec_actions))
        elif schema is Review:
            verdict = self.verdicts.popleft() if self.verdicts else "approve"
            m = re.search(r"- `([^`]+)`", user)
            out = Review(
                summary=f"Review verdict: {verdict}.",
                verdict=verdict,  # type: ignore[arg-type]
                score=8 if verdict == "approve" else 5,
                issues=[] if verdict == "approve" else ["Needs more depth."],
                revise_target=m.group(1) if (m and verdict == "revise") else None,
                feedback="Go deeper on the pattern." if verdict == "revise" else "",
            )
        else:  # pragma: no cover
            raise AssertionError(f"unexpected schema {schema}")
        text = getattr(out, "summary", "")
        if on_delta and text:
            for i in range(0, len(text), 12):
                await on_delta(text[i : i + 12])
        return out, Usage(len(user) // 4, len(text) // 4)

    async def chat(self, messages: list[dict[str, Any]], *, on_delta=None, temperature=None, model=None):
        await self._maybe_fail()
        text = "Based on the passages, the answer is clear [1]." if "[1] (" in messages[-1]["content"] or "[1] (" in messages[0]["content"] else "Hello from the agent."
        if on_delta:
            for i in range(0, len(text), 8):
                await on_delta(text[i : i + 8])
        return text, Usage(10, len(text) // 4)
