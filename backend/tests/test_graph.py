import pytest

from app.orchestration.spec import GraphInvalid, parse_graph, recursion_limit
from app.services.templates import TEMPLATES


def n(i, t, **data):
    return {"id": i, "type": t, "data": data}


def e(a, b):
    return {"id": f"{a}-{b}", "source": a, "target": b}


def test_templates_are_valid():
    for t in TEMPLATES:
        spec = parse_graph(t["graph"])
        assert spec.order
        assert recursion_limit(spec) >= 25


def test_topological_order_and_revisable_chain():
    spec = parse_graph({"nodes": [n("r", "research"), n("a", "analyst"), n("v", "reviewer")], "edges": [e("r", "a"), e("a", "v")]})
    assert spec.order == ["r", "a", "v"]
    assert spec.revisable["v"] == ["a", "r"]
    assert spec.entries == ["r"] and spec.exits == ["v"]


def test_join_limits_revision_chain():
    spec = parse_graph(
        {
            "nodes": [n("r1", "research"), n("r2", "research"), n("a", "analyst"), n("v", "reviewer")],
            "edges": [e("r1", "a"), e("r2", "a"), e("a", "v")],
        }
    )
    # the analyst is a join: it may be revised, but nothing before it
    assert spec.revisable["v"] == ["a"]


def test_cycle_rejected():
    with pytest.raises(GraphInvalid) as ex:
        parse_graph({"nodes": [n("a", "research"), n("b", "analyst")], "edges": [e("a", "b"), e("b", "a")]})
    assert "loop" in str(ex.value)


def test_unknown_type_and_dangling_edge():
    with pytest.raises(GraphInvalid) as ex:
        parse_graph({"nodes": [n("a", "wizard")], "edges": []})
    assert "unknown agent type" in str(ex.value)
    with pytest.raises(GraphInvalid):
        parse_graph({"nodes": [n("a", "research")], "edges": [e("a", "zzz")]})


def test_reviewer_cannot_feed_join():
    with pytest.raises(GraphInvalid) as ex:
        parse_graph(
            {
                "nodes": [n("r", "research"), n("v", "reviewer"), n("x", "research"), n("a", "analyst")],
                "edges": [e("r", "v"), e("v", "a"), e("x", "a")],
            }
        )
    assert "join" in str(ex.value) or "several inputs" in str(ex.value)


def test_isolated_node_rejected_and_caps_applied():
    with pytest.raises(GraphInvalid):
        parse_graph({"nodes": [n("a", "research"), n("b", "analyst")], "edges": []})
    spec = parse_graph({"nodes": [n("v", "reviewer", maxRevisions=99, temperature=9)], "edges": []})
    assert spec.nodes["v"].max_revisions == 5  # hard cap
    assert spec.nodes["v"].temperature == 1.5


async def test_validate_endpoint(client, auth):
    from tests.conftest import hdr

    r = await client.post(
        "/api/v1/workflows/validate",
        headers=hdr(auth),
        json={"name": "x", "graph": {"nodes": [n("a", "research"), n("b", "analyst")], "edges": [e("a", "b"), e("b", "a")]}},
    )
    assert r.status_code == 200 and r.json()["valid"] is False
