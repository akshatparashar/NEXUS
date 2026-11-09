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

## Production (2026-11-10) — WORKING
- Live: https://nexus-ai-worker.vercel.app (Vercel project `nexus`, team akshat-parashars-projects-ecb7d349; Git-connected, pushes to main deploy; the public domain now follows production).
- Verified live: signup; upload indexed in ~6 s (Gemini embeddings); Research brief run succeeded in 14 s (cited [1], reviewer 10/10, tokens streamed via Upstash); Analyze & act succeeded with a live revision loop. Gemini chose not to propose the deletion, so the approval pause was not exercised live (covered by tests and Playwright).
- How it works on Vercel: `COMMAND_QUEUE=stream` (default). Vercel's Python runtime runs no tasks after a response (wait_until included), so ingest/cancel run inside their request and a run executes inside its own SSE stream. `EMBEDDING_PROVIDER=google` (gemini-embedding-001 at 384 dims) because the local model cannot download on Vercel.
- Lessons: Windows `` in env values broke config once; the public alias stuck on an old build until `vercel domains add` + `vercel alias set`; health/config now shows `commit` and `command_queue` to catch that.

## Remaining (optional)
1. Light theme; custom domain; error monitoring.
2. Docker Compose untested (no Docker on the dev PC).
3. User said they will rotate the Neon/Upstash/Gemini credentials themselves.
