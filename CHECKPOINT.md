# NEXUS — session checkpoint (2026-11-09)

Read this first when resuming. The spec is `NEXUS_SPEC.md`; this file says what is done and what is left.

## Status: phases 1–7 done and verified; phase 8 (delivery) in progress

| Area | State | Proof |
|---|---|---|
| Backend (FastAPI, SQLAlchemy, Alembic, auth, workspaces) | done | `cd backend && py -m uv run pytest -q` → **31 passed** |
| LangGraph orchestration (canvas → StateGraph, reviewer loops w/ cap, joins, retries, timeouts, token budget, interrupt() approvals, Postgres checkpointer, crash recovery, retry-from-checkpoint) | done | tests in `backend/tests/test_runs.py` |
| RAG (pypdf, token chunker, fastembed bge-small 384d local, pgvector HNSW + tsvector, RRF hybrid, /ask streamed with citations) | done | `test_rag.py` + e2e |
| Events (transactional outbox → bus → worker/projector consumers, idempotency ledger, DLQ + replay, consumer stats) | done for `EVENT_BUS=memory`; **Kafka path written (aiokafka) but not yet run against a real broker** | — |
| Frontend (Next 16.4, Tailwind 4, React Flow, motion, cmdk): landing, login/register, overview, workflows, builder, runs, run detail, knowledge, playground, monitoring, settings | done | `cd web && npx playwright test` → **10/10 passed**; `npm run build` OK |
| Design | taste-skill inspector on landing: **0 FAIL**, 2 WARN (no-footage, still-page — defensible) | `.taste-skill/inspect/` |
| Screenshots | 20 PNGs in `docs/screenshots/` (made with the e2e harness) | `SHOTS=1 npx playwright test e2e/screenshots.spec.ts` |
| Docker | `docker-compose.yml`, `backend/Dockerfile`, `web/Dockerfile`, `.env.example` written; **not run (no Docker on this PC)** | — |

## Remaining TODO (in order)
1. **Real Kafka check**: Kafka 3.9.1 was being downloaded to `D:\coading\NEXUS\.kafka\` (may be incomplete; re-download `https://archive.apache.org/dist/kafka/3.9.1/kafka_2.13-3.9.1.tgz` if `kafka_2.13-3.9.1/` is missing). Java 21 is installed. Run KRaft single node (`bin\windows\kafka-storage.bat random-uuid`, `format -t <id> -c config\kraft\server.properties --standalone`, `kafka-server-start.bat config\kraft\server.properties`), then start the e2e harness with `EVENT_BUS=kafka KAFKA_BOOTSTRAP_SERVERS=localhost:9092` and rerun `npx playwright test`. Fix anything in `app/events/bus.py` (KafkaBus) that breaks.
2. **README.md** (root): what it is, architecture diagram, quick start (Compose), local dev without Docker (commands below), provider setup (OpenAI/Anthropic/Ollama), tests, screenshots gallery, design notes, honest notes (see "Notes for the report").
3. **docs/architecture**: diagram (mermaid in README + `docs/architecture.md`; optional SVG via the `diagram` skill).
4. Update `NEXUS_SPEC.md` where the build deviated: events code lives in `backend/app/events/` (not `kafka/`); font is Public Sans + JetBrains Mono (figures) instead of Geist; app tokens from the data-terminal style (`--ground #171719`, cards `#131217` darker than ground, accent `#4c8dff`, thinking violet `#a88bfa`).
5. Lint pass: `cd backend && py -m uv run ruff check app tests --select E,F,I,B,UP --ignore E501,B008,UP047,UP046`; `cd web && npx eslint src`.
6. Re-shoot screenshots once more (playground double-quirk fixed after the last shoot).
7. Final report to the user, then ask for an OpenAI/Anthropic key (or Ollama) to see real model output.

## How to bring the stack back after a reboot (no Docker)
```bash
# 1) embedded Postgres 16 + pgvector (pgserver). Port may change after reboot:
cd /d/coading/NEXUS/backend && py -m uv run python scripts/dev_db.py      # prints DATABASE_URL; put it in backend/.env
# 2a) API with the deterministic e2e test model (no key needed; resets DB nexus_e2e each start, E2E_RESET=0 keeps it)
E2E_PACE=0.05 py -m uv run python scripts/e2e_server.py                     # :8000
# 2b) or the real API (needs a model key in backend/.env)
py -m uv run python scripts/serve.py                                        # :8000 (selector loop for Windows)
# 3) web
cd /d/coading/NEXUS/web && npx next dev -p 3000                              # :3000, proxies /api/v1 → :8000
# tests
cd backend && py -m uv run pytest -q                                         # 31 tests, ~15 s
cd web && npx playwright test                                                # 10 e2e journeys (needs 2a + 3 running)
# design inspector
node C:/Users/aksha/.claude/skills/design-taste-frontend/scripts/inspect.mjs http://127.0.0.1:3000/
```
Tooling: `py -m uv` (uv installed via pip), Python 3.12 venv in `backend/.venv`, Node 24, npm. Playwright uses system Edge (`channel: msedge`).

## Key decisions already made (don't re-litigate)
- Design: app = taste-skill style **data-terminal** (seed 548054046); landing = direction **product-performs** (seed 1058355497). Glass only on floating layers; violet only = "LLM generating". Landing uses one face (no mono). Archival photos in `web/public/archive/` with credits in `credits.json` and the footer.
- `tests/extractive_llm.py` is a **test double** used only by `scripts/e2e_server.py`; production always uses `LangChainLLM` (`init_chat_model`). Never present its output as real model output.
- Process roles: `RUN_MODE=embedded|api|worker|projector`; relay runs in api/embedded; tokens go straight to pub/sub (not Kafka); lifecycle events go outbox → bus → projector → Redis/memory pub/sub → SSE.

## Notes for the final report
- No Docker and no LLM key on this PC: Compose is unverified here; screenshots/e2e use the extractive test double (clearly labelled).
- Taste-skill allowances: glass on floating layer (user brief), violet as a single signal (user brief), mono figures inside the app (style's "face" option), node-type tinted tiles in builder (`icon-chips`). Landing WARNs: no footage (hero replay is the moving element), still-page (13 moving elements).
- Sample content to replace before launch: `docs/samples/*` (fictional documents), landing board rows and hero traces (`web/src/components/landing/traces.ts`, `sections.tsx` BOARD), auth page aside fragment.
