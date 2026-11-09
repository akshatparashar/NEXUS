"""Starter workflows seeded into every new workspace."""

from typing import Any


def _node(nid: str, type_: str, x: int, y: int, label: str, instructions: str = "", **extra: Any) -> dict:
    return {
        "id": nid,
        "type": type_,
        "position": {"x": x, "y": y},
        "data": {"label": label, "instructions": instructions, **extra},
    }


def _edge(a: str, b: str) -> dict:
    return {"id": f"e-{a}-{b}", "source": a, "target": b}


TEMPLATES: list[dict[str, Any]] = [
    {
        "name": "Research brief",
        "description": "Research the knowledge base, analyse the findings, and have a reviewer check the result.",
        "graph": {
            "nodes": [
                _node("research", "research", 0, 120, "Research", "Find every relevant fact, figure and definition."),
                _node("analyst", "analyst", 340, 120, "Analyst", "Compare, find patterns and call out what is missing."),
                _node("reviewer", "reviewer", 680, 120, "Reviewer", "Approve only if the brief fully answers the task.", maxRevisions=2),
            ],
            "edges": [_edge("research", "analyst"), _edge("analyst", "reviewer")],
        },
    },
    {
        "name": "Analyze & act",
        "description": "Research and analyse, then let the Execution agent save a report. Risky actions wait for approval.",
        "graph": {
            "nodes": [
                _node("research", "research", 0, 120, "Research"),
                _node("analyst", "analyst", 320, 120, "Analyst"),
                _node(
                    "execution",
                    "execution",
                    640,
                    120,
                    "Execution",
                    "Save a well-structured Markdown report of the findings with save_report.",
                    tools=["save_report", "kb_search", "delete_document", "send_webhook"],
                ),
                _node("reviewer", "reviewer", 960, 120, "Reviewer", maxRevisions=1),
            ],
            "edges": [_edge("research", "analyst"), _edge("analyst", "execution"), _edge("execution", "reviewer")],
        },
    },
    {
        "name": "Two-angle comparison",
        "description": "Two researchers work in parallel on different angles; the analyst joins their work.",
        "graph": {
            "nodes": [
                _node("r_a", "research", 0, 0, "Research · Angle A", "Focus on benefits, capabilities and strengths."),
                _node("r_b", "research", 0, 240, "Research · Angle B", "Focus on costs, risks, limits and weaknesses."),
                _node("analyst", "analyst", 340, 120, "Analyst", "Weigh both angles against each other."),
                _node("reviewer", "reviewer", 680, 120, "Reviewer", maxRevisions=1),
            ],
            "edges": [_edge("r_a", "analyst"), _edge("r_b", "analyst"), _edge("analyst", "reviewer")],
        },
    },
]
