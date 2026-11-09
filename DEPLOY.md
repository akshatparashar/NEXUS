# Deploying NEXUS

Two supported ways:

| | What runs where | Cost |
|---|---|---|
| **Vercel** (this guide) | One Vercel project: the Next.js app and the FastAPI API as two *services*; Postgres on **Neon**; Redis on **Upstash** | Free tiers |
| **Docker Compose** | Everything on one machine or VM (`docker compose up --build`, see README) | Your server |

> Status: the Vercel setup below is written and the serverless code path is covered by
> `backend/tests/test_serverless.py`, but it has **not been deployed yet**. Expect to read the
> first build log carefully.

---

## How NEXUS runs on Vercel

```
browser ──► vercel.app ──┬─ /api/*, /docs ─► service "api"  (FastAPI, RUN_MODE=serverless)
                         └─ everything else ► service "web"  (Next.js)

POST /runs ─► run row + start command written in one transaction (outbox)
GET  /runs/{id}/stream (the run page opens it at once)
           └► this request takes the run's pending command and executes it while streaming
              ├► lifecycle events → projector, inline → Postgres (event log + run views)
              └► streamed tokens → Upstash Redis pub/sub → SSE in any API instance
POST /documents ─► the document is parsed, chunked and embedded before the request returns
```

- **Work only happens inside open requests** (`COMMAND_QUEUE=stream`, the default). Vercel's Python
  runtime does not run tasks after a response is sent (`wait_until` included, in our tests), so uploads
  and cancels finish before their request returns, and a run executes inside its own live stream. A
  second viewer of the same run finds nothing to take; if the viewer leaves mid-run, the next one
  resumes it from its last checkpoint. (`COMMAND_QUEUE=vercel` targets Vercel Queues, but its
  `[[tool.vercel.subscribers]]` consumer was not generated inside a Services FastAPI service.)
- **Durable.** Runs checkpoint to Postgres after every step, so a re-queued run resumes, it does not restart.
- **Approvals** pause the run and end the function; the decision queues a `resume` command.
- **Cancelling** a run marks it cancelled; the instance running it notices within 5 seconds and stops.

## 1. Database: Neon (free)

1. Create a project at [neon.tech](https://neon.tech) (Postgres 16 or 17, a region near your Vercel region, e.g. `us-east-1` for Vercel `iad1`).
2. Copy the **direct** connection string (the host *without* `-pooler`). The async driver uses
   prepared statements, which the pooled endpoint does not keep between transactions.
   It looks like `postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require`.
   Keep `?sslmode=require`; NEXUS translates it for both drivers.
3. Create the schema from your machine (this also enables `pgvector`):
   ```bash
   cd backend
   DATABASE_URL="postgresql://…?sslmode=require" uv run alembic upgrade head
   ```
   On Windows PowerShell: `$env:DATABASE_URL="…"; py -m uv run alembic upgrade head`.

Supabase also works (enable the `vector` extension, use the direct connection on port 5432).

## 2. Realtime: Upstash Redis (free)

Create a Redis database at [upstash.com](https://upstash.com) in the same region and copy the
`rediss://default:…@….upstash.io:6379` URL. It carries live tokens and the workspace activity feed
between function instances. Without it runs still work and the run page still updates (it reads
the event log), but text no longer streams word by word.

`TOKEN_FLUSH_MS=120` batches tokens: a run publishes a few hundred times instead of once per token.

## 3. Vercel project

1. Push the repository to GitHub, then **Add New → Project** on vercel.com and import it.
   Leave **Root Directory** at the repository root: `vercel.json` defines both services.
2. **Settings → Functions**: keep Fluid compute on (the default).
3. **Settings → Environment Variables** (Production and Preview):

| Variable | Value |
|---|---|
| `RUN_MODE` | `serverless` |
| `DATABASE_URL` | the Neon direct URL from step 1 |
| `REDIS_URL` | the Upstash `rediss://` URL from step 2 |
| `JWT_SECRET` | `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `LLM_PROVIDER` / `LLM_MODEL` | `google` / `gemini-3.5-flash-lite` (free tier), `openai` / `gpt-4.1-mini`, or `anthropic` / `claude-sonnet-5-5` |
| `GOOGLE_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | your key for that provider |
| `EMBEDDING_PROVIDER` | `google` (uses `GOOGLE_API_KEY`, recommended) or `openai`. Not `local`: the model download fails on Vercel |
| `UPLOAD_STORAGE` | `database` |
| `MAX_UPLOAD_MB` | `4` (Vercel caps request bodies at 4.5 MB) |
| `RUN_TIMEOUT_SECONDS` | `270` on Hobby (functions stop at 300 s); up to `780` on Pro |
| `TOKEN_FLUSH_MS` | `120` |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | `3` / `2` |
| `COOKIE_SECURE` | `true` |
| `CORS_ORIGINS` | `["https://your-project.vercel.app"]` |
| `ENVIRONMENT` / `LOG_JSON` | `production` / `true` |
| `NEXT_PUBLIC_SITE_URL` | `https://your-project.vercel.app` (social previews) |

4. Deploy. Then check:
   - `https://your-project.vercel.app/api/v1/health` → `{"status":"ok","database":true}`
   - `https://your-project.vercel.app/api/v1/health/config` → the model shows `configured: true`,
     `event_bus.kind` is `serverless`, `realtime.kind` is `redis`
   - register, upload a small document, run "Research brief".

### What the build uses

- `vercel.json`: services `web` (`web/`, Next.js) and `api` (`backend/`, FastAPI via `backend/main.py`),
  with `/api/*`, `/docs` and `/openapi.json` routed to the API. The API function gets `maxDuration: 300`.
- `backend/pyproject.toml` → `[[tool.vercel.subscribers]]` declares `app/workers/vercel_queue.py` as a
  queue consumer, used only with `COMMAND_QUEUE=vercel`.

## Limits to know

- **Run length.** A run executes inside its stream request, so it must finish inside the function
  limit (300 s on Hobby) and runs while its page is open. `RUN_TIMEOUT_SECONDS` fails it cleanly first; *Retry* continues from the last checkpoint.
- **Uploads** up to about 4 MB each on Vercel.
- **Ollama** (local models) needs a machine of your own: use Docker Compose for that.
- **Embeddings** must come from an API on Vercel (`google` or `openai`); the local model cannot be
  downloaded there. Changing provider later means re-processing documents (same 384 dimensions, different vectors).

## Testing the serverless path locally

```bash
cd backend
RUN_MODE=serverless COMMAND_QUEUE=inline UPLOAD_STORAGE=database uv run python scripts/serve.py
uv run pytest tests/test_serverless.py -q
```
