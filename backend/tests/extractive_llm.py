"""A deterministic, extractive stand-in for an LLM, used only by the e2e harness (scripts/e2e_server.py).

It never invents content: every sentence it writes is lifted from the numbered passages or the
upstream agents' output it was given, and it cites the passage it came from. This lets the full
system (LangGraph, RAG, outbox, Kafka-style consumers, SSE, UI) be exercised end to end without an
API key. Production always uses a real model through app.agents.llm.LangChainLLM.
"""

import asyncio
import json
import re
from typing import Any

from pydantic import BaseModel

from app.agents.llm import LLMClient, Usage
from app.agents.schemas import (
    AnalysisResult,
    ExecutionPlan,
    PlannedAction,
    ResearchResult,
    Review,
    SearchPlan,
)

STOP = set("the a an and or of to in on for with is are was were be by as at from that this it its our your what which who how why does do did".split())


def _passages(text: str) -> list[tuple[int, str, str]]:
    out = []
    for m in re.finditer(r"\[(\d+)\] \(([^)]*)\)\n(.*?)(?=\n\n\[\d+\] \(|\Z)", text, re.S):
        out.append((int(m.group(1)), m.group(2), " ".join(m.group(3).split())))
    return out


def _sentences(text: str) -> list[str]:
    text = re.sub(r"#{1,6} [^#]*?(?= [A-Z][a-z])", " ", text)  # drop Markdown headings run into the text
    text = re.sub(r"\s+\d+\. ", " ", text)
    out = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if 30 <= len(s.strip()) <= 260]
    return [s for s in out if "sample document" not in s]


def _task(user: str) -> str:
    return user.split("## Task\n", 1)[-1].split("\n\n", 1)[0].strip()


def _keywords(text: str, n: int = 6) -> list[str]:
    words = [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z\-]{3,}", text)]
    seen: list[str] = []
    for w in words:
        if w not in STOP and w not in seen:
            seen.append(w)
    return seen[:n]


def _rank(sentences: list[tuple[int, str]], task: str) -> list[tuple[int, str]]:
    kws = set(_keywords(task, 12))
    return sorted(sentences, key=lambda s: -len(kws & set(w.lower() for w in re.findall(r"[A-Za-z]{4,}", s[1]))))


class ExtractiveLLM(LLMClient):
    provider = "e2e-extractive"
    model = "extractive-test-double"

    def __init__(self, pace: float = 0.012) -> None:
        self.pace = pace

    async def _stream(self, text: str, on_delta) -> None:
        if not on_delta:
            return
        for i in range(0, len(text), 6):
            await on_delta(text[i : i + 6])
            await asyncio.sleep(self.pace)

    async def structured(self, schema: type[BaseModel], system: str, user: str, *, on_delta=None, stream_field="summary", temperature=None, model=None):
        task = _task(user)
        passages = _passages(user)
        cands = _rank([(n, s) for n, _, body in passages for s in _sentences(body)], task)
        upstream = user.split("## Upstream work\n", 1)[-1] if "## Upstream work" in user else ""
        revising = "## Revision requested" in user
        out: BaseModel
        if schema is SearchPlan:
            kws = _keywords(task, 8)
            out = SearchPlan(rationale="Search for the key terms of the task.", queries=[" ".join(kws[:4]) or task[:60], " ".join(kws[4:8]) or task[:40]][: 2 if len(kws) > 4 else 1])
        elif schema is ResearchResult:
            picked = cands[:4]
            if picked:
                summary = " ".join(f"{s} [{n}]" for n, s in picked[:3])
                findings = [{"claim": s, "citations": [n]} for n, s in picked]
                oq: list[str] = []
            else:
                summary = "The knowledge base has no passages that address this task. Add a document that covers it."
                findings = [{"claim": "No relevant passages were found in the knowledge base.", "citations": []}]
                oq = [f"What do our documents say about {task.rstrip('.?')}?"]
            out = ResearchResult(summary=summary, findings=findings, open_questions=oq)
        elif schema is AnalysisResult:
            claims = re.findall(r"^- (.+?)(?: \[\d+\])*$", upstream, re.M)[:4] or _sentences(upstream)[:3]
            cites = sorted(set(re.findall(r"\[(\d+)\]", upstream)))[:3]
            tag = "".join(f" [{c}]" for c in cites[:1])
            lead = "Revised to address the reviewer: " if revising else ""
            summary = (
                f"{lead}The research gives {len(claims)} grounded points on the task.{tag} "
                + (f"The strongest is: {claims[0].rstrip('.')}." if claims else "There is little evidence to work with.")
                + " The remaining points support it; gaps are listed below."
            )
            out = AnalysisResult(
                summary=summary,
                insights=[{"title": f"Point {i + 1}", "detail": c[:240]} for i, c in enumerate(claims[:3])] or [{"title": "Thin evidence", "detail": "Upstream research found little to analyse."}],
                gaps=["Figures for comparison periods are not in the documents."] if claims else ["No source material."],
                risks=[],
                confidence=0.78 if claims else 0.3,
            )
        elif schema is ExecutionPlan:
            report = "\n".join(f"- {c}" for c in re.findall(r"^- (.+)$", upstream, re.M)[:8]) or "- No findings."
            actions = [PlannedAction(tool="save_report", args_json=json.dumps({"title": f"Report: {task[:60]}", "content": f"# {task}\n\n{report}\n"}), reason="Keep the findings as a report.")]
            m = re.search(r"(?:delete|remove)\s+(?:the\s+)?(?:document\s+)?[\"“]?([\w\-. ]+\.(?:pdf|txt|md))", task, re.I)
            if m:
                actions.append(PlannedAction(tool="delete_document", args_json=json.dumps({"filename": m.group(1).strip()}), reason="The task asks for this document to be removed."))
            out = ExecutionPlan(summary=f"I will save a report of the findings{' and remove ' + m.group(1) if m else ''}.", actions=actions)
        elif schema is Review:
            # One deterministic revision round on analysis-only graphs; approve when actions were taken.
            first_time = "Revised to address" not in user
            candidates = re.findall(r"- `([^`]+)` \(([^)]*)\)", user.split("## Nodes you may send back", 1)[-1])
            target = next((m for m in candidates if "nalyst" in m[1] or m[0].startswith("analyst")), None)
            acted = "Actions:" in user
            if first_time and target and not acted:
                target = re.match(r"(.*)", target[0])
                out = Review(summary="The work is grounded but thin. Ask the analyst to rank the points.", verdict="revise", score=6, issues=["The points are not ranked."], revise_target=target.group(1), feedback="Rank the points by importance and say which one matters most.")
            else:
                out = Review(summary="Every claim is cited and the analysis answers the task. Approved.", verdict="approve", score=8, issues=[])
        else:  # pragma: no cover
            raise AssertionError(schema)
        await self._stream(getattr(out, "summary", ""), on_delta)
        return out, Usage(len(system + user) // 4, len(out.model_dump_json()) // 4)

    async def chat(self, messages: list[dict[str, Any]], *, on_delta=None, temperature=None, model=None):
        system = messages[0]["content"] if messages and messages[0]["role"] == "system" else ""
        question = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        if question.startswith("Question:"):
            question = question.split("\n", 1)[0].removeprefix("Question:").strip()
        passages = _passages(system) or _passages(messages[-1]["content"])
        cands = _rank([(n, s) for n, _, b in passages for s in _sentences(b)], question)
        if cands:
            text = " ".join(f"{s} [{n}]" for n, s in cands[:3])
        else:
            text = "I have no passages from the knowledge base for this. Add a document that covers it and ask again."
        await self._stream(text, on_delta)
        return text, Usage(len(system) // 4, len(text) // 4)
