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

## Production (2026-11-10)
- Live: https://nexus-three-steel-20.vercel.app (Vercel project `nexus`, team akshat-parashars-projects-ecb7d349, Git-connected to akshatparashar/NEXUS main → every push deploys).
- Working live: all pages; signup/login; /docs; /api/v1/health; health/config shows serverless + Gemini configured + Neon (pgvector 0.8.6) + Upstash Redis.
- Credentials: local git-ignored `.env.deploy`; Vercel has 18 vars × production/preview (re-added once: the first upload carried Windows `` endings and crashed the API).
- **Open blocker:** background work does not run in production. Uploads stay `uploaded` (progress 0) and runs stay queued. Commands are written and marked published. First attempt (Vercel Queues): the Services build generated no `[[tool.vercel.subscribers]]` consumer. Second attempt (`COMMAND_QUEUE=inline` + `vercel.functions.wait_until`, commit 05f202b): still nothing processed and no errors in `vercel logs`. Next steps: add logging around `_keep_alive`/`handle_command` to confirm the task starts on Vercel; test whether `wait_until` works from inside an ASGI (FastAPI) request on the Python runtime; fallback options: run the command synchronously inside the request (upload/ingest is small; runs <300 s) or a Vercel Cron/Workflow-based worker.

## Remaining
1. Fix the production background-work blocker above, then run `scratchpad`-style smoke test (register → upload → Research brief run) on the live URL.
2. Research agent sometimes omits [n] citation markers with Gemini — prompt tweak.
3. Optional: light theme; Docker Compose on a machine with Docker.
