from app.rag.chunking import chunk_pages, count_tokens
from app.rag.parsing import Page, UnsupportedDocument, sniff_type
from tests.conftest import hdr, upload_text

SOLAR = """Solar panels convert sunlight into electricity using photovoltaic cells made of silicon.
A typical residential installation produces between 6 and 10 kilowatts of peak power.

Panel efficiency has improved steadily; modern monocrystalline modules reach 22 percent efficiency.
Inverters convert the direct current produced by the panels into alternating current for the home."""

COFFEE = """Espresso is brewed by forcing hot water through finely ground coffee under nine bars of pressure.
A good shot takes between 25 and 30 seconds and produces a layer of crema on top.

Arabica beans are generally sweeter and more acidic than Robusta beans, which contain more caffeine."""


def test_chunking_respects_limits_and_overlap():
    text = " ".join(f"Sentence number {i} talks about topic {i % 7}." for i in range(400))
    chunks = chunk_pages([Page(3, text)], max_tokens=120, overlap_tokens=20)
    assert len(chunks) > 5
    assert all(c.token_count <= 140 for c in chunks)
    assert all(c.page == 3 for c in chunks)
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))
    # overlap: the start of each chunk repeats words from the end of the previous one
    assert chunks[1].content.split()[0] in chunks[0].content
    assert count_tokens("hello world") == 2


def test_type_sniffing():
    assert sniff_type("a.pdf", b"%PDF-1.7 ...") == "application/pdf"
    assert sniff_type("notes.md", b"# Title") == "text/markdown"
    for name, head in [("a.pdf", b"not a pdf"), ("a.exe", b"MZ"), ("a.txt", b"\x00\x01binary")]:
        try:
            sniff_type(name, head)
        except UnsupportedDocument:
            continue
        raise AssertionError(f"{name} should be rejected")


async def test_upload_ingest_and_hybrid_search(client, auth):
    solar = await upload_text(client, auth, "solar.txt", SOLAR)
    coffee = await upload_text(client, auth, "coffee.txt", COFFEE)
    assert solar["status"] == "ready" and solar["chunk_count"] >= 1
    assert coffee["status"] == "ready"

    r = await client.post("/api/v1/search", headers=hdr(auth), json={"query": "how efficient are monocrystalline panels", "k": 3})
    assert r.status_code == 200
    results = r.json()["results"]
    assert results and results[0]["filename"] == "solar.txt"
    assert results[0]["keyword_rank"] == 1 or results[0]["vector_rank"] == 1

    r = await client.post("/api/v1/search", headers=hdr(auth), json={"query": "espresso pressure crema", "k": 3})
    assert r.json()["results"][0]["filename"] == "coffee.txt"


async def test_upload_restrictions(client, auth):
    bad = await client.post("/api/v1/documents", headers=hdr(auth), files={"file": ("evil.exe", b"MZ....", "application/octet-stream")})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "unsupported_file"
    fake_pdf = await client.post("/api/v1/documents", headers=hdr(auth), files={"file": ("x.pdf", b"hello", "application/pdf")})
    assert fake_pdf.status_code == 422
    empty = await client.post("/api/v1/documents", headers=hdr(auth), files={"file": ("e.txt", b"", "text/plain")})
    assert empty.status_code == 422
    await upload_text(client, auth, "dup.txt", "Duplicate content check for the knowledge base.")
    dup = await client.post("/api/v1/documents", headers=hdr(auth), files={"file": ("dup2.txt", b"Duplicate content check for the knowledge base.", "text/plain")})
    assert dup.status_code == 409


async def test_ask_is_grounded_with_sources(client, auth):
    await upload_text(client, auth, "solar.txt", SOLAR)
    async with client.stream("POST", "/api/v1/ask", headers=hdr(auth), json={"question": "What does an inverter do for solar panels?"}) as r:
        body = "".join([chunk async for chunk in r.aiter_text()])
    assert "event: sources" in body and "solar.txt" in body
    assert "event: token" in body and "event: done" in body
    assert '"cited": [1]' in body
