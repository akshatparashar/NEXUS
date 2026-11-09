# NEXUS — session checkpoint (2026-11-09)

Read this first when resuming. The spec is `NEXUS_SPEC.md`; this file says what is done and what is left.

## Status: all 8 phases done (2026-11-09). Waiting on the user for a model key.

| Area | State | Proof |
|---|---|---|
| Backend | done | `cd backend && py -m uv run pytest -q` → **31 passed**; ruff clean |
| Events | done on **both** buses | Playwright 10/10 on `EVENT_BUS=memory` and on a real Kafka 3.9.1 broker; consumer groups at lag 0, DLQ empty |
| Frontend | done | `npx playwright test` → **12/12** (10 journeys + 2 regressions in `e2e/regressions.spec.ts`); eslint + tsc clean |
| Docs | done | `README.md`, `docs/architecture.md` + `.mmd/.svg/.png/.excalidraw`, spec deltas at the top of `NEXUS_SPEC.md` |
| Screenshots | re-shot, 20 PNGs | dev-tools badge hidden, 07 no longer skeletons |
| Docker | written, **not run** (no Docker on this PC) | — |

Fixed in the delivery session: SSE endpoints pinned a pooled DB connection for the whole stream (now released after the up-front reads); `?task=` run dialog reopened itself after closing; elapsed timers only updated on unrelated re-renders (now `useNow`); live node preview started mid-word; React-compiler lint findings (state resets moved out of effects).

## Remaining TODO
1. Get an OpenAI/Anthropic key (or Ollama) from the user and look at real model output in a full run.
2. Optional: run `docker compose up --build` on a machine with Docker.
3. Optional: commit (user has not asked yet).

### Local Kafka (no Docker)
`.kafka/kafka_2.13-3.9.1/` is extracted and formatted (data in `.kafka/data`). The `.bat` scripts fail ("input line is too long"), so start it with java directly:
```bash
cd /d/coading/NEXUS/.kafka/kafka_2.13-3.9.1 && java -Xmx512m -Dlog4j.configuration=file:config/log4j.properties -Dkafka.logs.dir=D:/coading/NEXUS/.kafka/logs -cp 'D:/coading/NEXUS/.kafka/kafka_2.13-3.9.1/libs/*' kafka.Kafka config/kraft/server.properties
```
Then start the API with `EVENT_BUS=kafka KAFKA_BOOTSTRAP_SERVERS=localhost:9092`.

## How to bring the stack back after a reboot (no Docker)
```bash
# 1) embedded Postgres 16 + pgvector (pgserver). Port may change after reboot. After an unclean shutdown,
#    WAL recovery can exceed pgserver's 10 s start timeout: wait until .pgdata/postmaster.pid line 8 says 'ready', rerun.
cd /d/coading/NEXUS/backend && py -m uv run python scripts/dev_db.py      # prints DATABASE_URL; put it in backend/.env
# 2a) API with the deterministic e2e test model (no key needed; resets DB nexus_e2e each start, E2E_RESET=0 keeps it)
E2E_PACE=0.05 py -m uv run python scripts/e2e_server.py                     # :8000
# 2b) or the real API (needs a model key in backend/.env)
py -m uv run python scripts/serve.py                                        # :8000 (selector loop for Windows)
# 3) web
cd /d/coading/NEXUS/web && npx next dev -p 3000                              # :3000, proxies /api/v1 → :8000
# tests
cd backend && py -m uv run pytest -q                                         # 31 tests, ~15 s
cd web && npx playwright test                                                # 12 e2e tests (needs 2a + 3 running)
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

## Session 2026-11-09/10 (b): redesign, Vercel readiness, Gemini — DONE
- **UI "Spectrum"**: monochrome + one hue per agent (research #4fd1ff, analyst #8b85ff, execution #ff5fa2, reviewer #ffb84d), glass floating layer, Geist. Bottom glass dock (`web/src/components/dock/dock.tsx`) replaces the rail; landing rebuilt with GSAP (hero SplitText, pinned DrawSVG relay, horizontal pipeline, Flip tabs). Running state uses the agent's own colour (builder nodes, run tape).
- **Serverless backend** (`RUN_MODE=serverless`): outbox `flush()` per request, `ServerlessBus` (commands → Vercel Queues via `app/workers/vercel_queue.py`, lifecycle projected inline), uploads in `documents.content` (migration a1c4e2b9f0d3), SSE reads the event log, `kick_if_stale` re-queues orphaned runs, heartbeat stops runs cancelled elsewhere, token coalescing (`TOKEN_FLUSH_MS`), Neon `sslmode` URL handling. `vercel.json` (services web+api), `backend/main.py`, `DEPLOY.md` (Neon + Upstash).
- **Gemini provider** (`LLM_PROVIDER=google`, `gemini-3.5-flash-lite`, key in git-ignored backend/.env). Real run verified: Research brief, 78 s, ~5k tokens, approved. Fixed `_inline_refs` dropping a field named `title`.
- Verified: 33 backend tests, 12/12 Playwright on the production build, `next build`. Not verified: an actual Vercel deploy, Docker.
- Quirk: after long sessions `next dev` can fail with 0xc0000142 (Turbopack can't spawn its CSS worker); `next build && next start` works. Kill leftover node processes first.

## Remaining
1. User deploys per DEPLOY.md (needs Vercel, Neon, Upstash accounts); read the first build log together.
2. Research agent sometimes omits [n] citation markers with Gemini (analyst cites fine) — prompt tweak.
3. Optional: light theme; `docker compose up` on a machine with Docker.
