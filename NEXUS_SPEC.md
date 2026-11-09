# NEXUS AI — Product & Engineering Spec (v2)

> The improved build prompt. This file replaces the original prompt and is the working spec for every phase.
> Design direction is informed by the `design-taste-frontend` (tasteskill) and `apple-design` (HIG) skills; both run again at Phase 6 and as review gates later on.

---

## 0. What we are building, in one sentence

**NEXUS AI turns a drawn graph of AI agents into a durable, observable, event-driven run.** You draw it, it runs, and you watch every step happen.

Each word in that sentence has to be real:

| Claim | What makes it real |
|---|---|
| *drawn graph* | A React Flow canvas that compiles **into** a LangGraph `StateGraph`. The canvas is the program, not a picture of it. |
| *durable* | LangGraph Postgres checkpointer. A run survives a worker restart and can be resumed, retried or approved midway. |
| *event-driven* | The API never runs agents. It writes a command into an outbox → Kafka → a worker runs the graph → lifecycle events go back through Kafka. |
| *observable* | Every token, tool call, retry and event is persisted and streamed to the UI over SSE, with replay. |
| *grounded* | Agents retrieve from the workspace knowledge base with hybrid search and cite sources by chunk. |

It is **not** a chatbot with extra pages. The Playground is a debugging surface for single agents. The product is the workflow run.

---

## 1. Key upgrades over the original prompt

1. **The canvas compiles to LangGraph.** In the original prompt the builder and the engine were two separate things. Here, nodes and edges become graph nodes and conditional edges, and the graph is validated before it runs (no orphan nodes, reachable END, a revision cap on every cycle).
2. **Kafka drives the execution.** Kafka is not a log sink on the side. `workflow.run.requested` is consumed by the worker that executes the run. A **transactional outbox** guarantees that no event is lost between the DB and Kafka. There is also a **DLQ**, idempotent consumers and consumer-lag monitoring.
3. **Human-in-the-loop approval** uses LangGraph `interrupt()`. Destructive tools pause the run, and the UI shows an Approve or Reject sheet. This satisfies "explicit approval before destructive actions" as a real feature.
4. **Hybrid RAG.** pgvector HNSW and Postgres full-text search, fused with Reciprocal Rank Fusion. Ingestion runs async through Kafka (`document.uploaded`) and shows live progress.
5. **Workspaces (multi-tenant).** The workspace selector from the spec is real: every row is scoped by `workspace_id`.
6. **Provider-agnostic LLM layer.** `init_chat_model` supports OpenAI, Anthropic and Ollama (local, free). A config check endpoint and a setup screen handle missing keys gracefully. The app never fakes results.
7. **Efficiency features.** A ⌘K command palette, keyboard shortcuts on the canvas, run templates, "re-run with same input", and diffs between runs.
8. **Design rules that resolve the brief's contradictions.** "Glassmorphism, violet and blue" sits next to "avoid generic purple AI templates". Section 6 settles this with rules: glass only on the floating layer, and one meaning per colour.

---

## 2. Architecture

```
                        ┌──────────────────────────── Next.js (web) ────────────────────────────┐
                        │  Landing · Dashboard · Builder(React Flow) · Playground · KB · Monitor │
                        └──────────────┬──────────────────────────────▲──────────────────────────┘
                                REST (JWT)                       SSE (Last-Event-ID replay)
                                       │                              │
┌──────────────────────────────────────▼──────────────────────────────┴───────────────────────────┐
│ FastAPI  (api container)                                                                         │
│  api/ routes → services/ business logic → database/ repositories                                 │
│  writes domain rows + OUTBOX row in ONE transaction                                              │
│  SSE endpoint subscribes to Redis pub/sub channel run:{id}                                       │
└───────┬───────────────────────────────────────────────────────────────────────▲─────────────────┘
        │ outbox relay (async task)                                             │ Redis pub/sub
        ▼                                                                       │
┌──────────────── Kafka (KRaft, single broker) ─────────────────┐               │
│ nexus.commands   : workflow.run.requested, document.uploaded  │               │
│ nexus.lifecycle  : workflow.started, agent.started,           │               │
│                    agent.token, tool.called, agent.completed, │               │
│                    agent.failed, approval.required,           │               │
│                    workflow.completed, workflow.failed        │               │
│ nexus.dlq        : poison messages after N attempts           │               │
└───────┬─────────────────────────────────────┬─────────────────┘               │
        ▼                                     ▼                                 │
┌──── worker container ────┐       ┌──── projector consumer ─────┐              │
│ consumes commands         │       │ consumes lifecycle          │──────────────┘
│ compiles graph → LangGraph│       │ persists execution_events   │
│ runs agents, RAG, tools   │       │ updates run/step rows,      │
│ Postgres checkpointer     │       │ metrics rollups, publishes  │
│ emits lifecycle via outbox│       │ to Redis for SSE fan-out    │
└──────────┬────────────────┘       └─────────────────────────────┘
           ▼
┌──────── PostgreSQL 16 + pgvector ────────┐   ┌── Redis ──┐
│ users, workspaces, workflows, runs,      │   │ pub/sub,  │
│ run_steps, execution_events, documents,  │   │ rate-limit│
│ chunks(vector + tsvector), outbox,       │   │ cache     │
│ processed_events, langgraph checkpoints  │   └───────────┘
└──────────────────────────────────────────┘
```

**One codebase and three processes:** `api`, `worker` and `projector` all start from the same Python package with different entrypoints. The architecture is modular without the cost of microservices.

### Stack (pinned choices)

| Layer | Choice |
|---|---|
| Web | Next.js (App Router, latest stable), TypeScript strict, Tailwind v4, `motion` (Framer Motion), `@xyflow/react`, TanStack Query, Zustand (canvas state), `cmdk`, Lucide, Geist Sans |
| API | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.0 async + asyncpg, Alembic, `structlog`, `uv` for deps |
| AI | LangGraph + `langgraph-checkpoint-postgres`, LangChain `init_chat_model`, structured outputs via Pydantic |
| RAG | `pypdf`, recursive token chunker (≈512 tokens / 64 overlap), embeddings (OpenAI `text-embedding-3-small` or Ollama `nomic-embed-text`), pgvector HNSW + `tsvector` GIN, RRF fusion |
| Messaging | Apache Kafka (official `apache/kafka` image, KRaft, no ZooKeeper), `aiokafka` |
| Infra | Docker Compose (profiles: `core`, `ollama`), healthchecks, `.env` via `pydantic-settings` |
| Tests | pytest + pytest-asyncio, testcontainers (Postgres, Kafka), LangChain fake chat model **in tests only**; Playwright e2e and screenshot capture |

---

## 3. Backend layout

```
backend/
  app/
    core/          config, security (JWT, hashing), logging, errors, deps
    database/      engine, session, base, repositories/
    models/        SQLAlchemy models
    schemas/       Pydantic request/response + event envelopes
    api/v1/        auth, workspaces, workflows, runs, documents, search, agents, monitoring, stream, health
    services/      workflow_service, run_service, document_service, metrics_service, approval_service
    agents/        research.py, analyst.py, execution.py, reviewer.py, prompts/, base.py
    tools/         registry.py (allowlist + `destructive` flag), kb_search, http_get, write_report, send_webhook(destructive)
    orchestration/ compiler.py (canvas JSON → StateGraph), state.py, routing.py, guards.py (timeouts, caps)
    rag/           parsing.py, chunking.py, embeddings.py, retrieval.py (hybrid + RRF), citations.py
    kafka/         producer.py, outbox_relay.py, consumer_base.py (idempotency, retry, DLQ), topics.py
    workers/       run_worker.py, ingest_worker.py, projector.py
    main.py
  migrations/      Alembic
  tests/           unit/, integration/, e2e-api/
```

### Data model (core tables)

- `users`(id, email, password_hash, name) · `workspaces`(id, name, slug) · `memberships`(user_id, workspace_id, role)
- `workflows`(id, workspace_id, name, description, graph_json, version, created_by, updated_at)
- `workflow_runs`(id, workflow_id, workflow_version, status[queued|running|awaiting_approval|succeeded|failed|cancelled|timed_out], input, output, error, started_at, finished_at, duration_ms, token_usage, cost_estimate)
- `run_steps`(id, run_id, node_id, agent_type, attempt, status, input_summary, output, error, started_at, finished_at, tokens)
- `execution_events`(id, run_id, seq, type, payload jsonb, created_at): append-only, used to replay SSE
- `approvals`(id, run_id, step_id, tool, args, status, decided_by, decided_at)
- `documents`(id, workspace_id, filename, mime, size, sha256, status[uploaded|parsing|embedding|ready|failed], pages, chunk_count, error)
- `chunks`(id, document_id, workspace_id, ordinal, content, page, embedding vector(N), tsv tsvector)
- `outbox`(id, topic, key, payload, created_at, published_at) · `processed_events`(consumer, event_id)

### Event envelope

```json
{ "event_id": "uuid", "type": "agent.completed", "version": 1, "occurred_at": "…",
  "workspace_id": "…", "run_id": "…", "step_id": "…", "seq": 42, "payload": { } }
```
Key = `run_id`, which keeps ordering per run. Consumers are idempotent on `event_id`. After 3 failed attempts a message goes to `nexus.dlq` and shows up in Monitoring.

---

## 4. Agent orchestration

**Shared state** (`TypedDict`): `task`, `workspace_id`, `research: ResearchResult`, `analysis: Analysis`, `execution: ExecutionReport`, `review: Review`, `revision_count`, `messages`, `citations`, `errors`.

**Agents** (each one is a LangGraph node with a structured Pydantic output and its own system prompt, and the user can append instructions in the canvas inspector):

| Agent | Tools | Output |
|---|---|---|
| Research | `kb_search` (hybrid RAG), optional `http_get` (allowlisted domains) | `findings[]` with `source_chunk_ids`, `open_questions[]` |
| Analyst | none (reasoning) | `insights[]`, `gaps[]`, `confidence` |
| Execution | tool registry; destructive tools → `interrupt()` for approval | `actions[]` with status and results |
| Reviewer | none | `verdict: approve \| revise`, `issues[]`, `target_node` |

**Routing:** the reviewer has a conditional edge. `revise` goes back to `target_node` while `revision_count < max_revisions` (default 2, hard cap 5), and anything else goes to END. The compiler rejects cycles that have no reviewer cap.

**Guards:** per-node timeout (default 90s), whole-run timeout (default 10 min), retry with exponential backoff on transient LLM errors (max 3), a recursion limit, and a token budget per run. Every guard trip emits `agent.failed` with a reason.

**Default templates** (seeded): *Research brief* (R → A → Rv), *Analyze & act* (R → A → E → Rv), *Doc Q&A* (R → Rv).

---

## 5. API surface (v1, documented in Swagger)

`POST /auth/register · /auth/login · /auth/refresh · GET /auth/me`
`GET/POST /workspaces`
`GET/POST /workflows · GET/PUT/DELETE /workflows/{id} · POST /workflows/{id}/validate`
`POST /workflows/{id}/runs · GET /runs?status&workflow · GET /runs/{id} · POST /runs/{id}/cancel · POST /runs/{id}/retry`
`GET /runs/{id}/stream` (SSE, supports `Last-Event-ID`)
`POST /approvals/{id}/approve|reject`
`POST /documents` (multipart, PDF/TXT/MD only, ≤ 20 MB, magic-byte check) · `GET /documents · DELETE /documents/{id}`
`POST /search` (hybrid retrieval) · `POST /ask` (grounded answer with citations, streamed)
`POST /agents/{type}/chat` (Playground, streamed)
`GET /monitoring/overview · /monitoring/agents · /monitoring/events · /monitoring/kafka` (lag, DLQ, throughput)
`GET /health · /health/config` (which providers and keys are configured, with no secrets returned)

---

## 6. Design system: "Instrument"

### The idea
> **On NEXUS, the agent run itself becomes the interface.** The product's real output (a graph lighting up step by step, with streamed reasoning and cited sources) is the hero image, the dashboard's centrepiece and the landing page's live demo. No stock illustrations, no gradient blobs, no fake grey-bar dashboards.

The competitor test: "a run trace that is literally your canvas compiling into steps" is specific to a canvas-to-LangGraph product. A generic "AI sparkle" visual is not.

### Resolving the brief's tensions (taste and HIG rules)
| Brief asks for | Rule we follow |
|---|---|
| Glassmorphism | **Glass only on the floating functional layer**: top bar on scroll, ⌘K palette, node inspector sheet, popovers, toasts and the approval sheet. **Never on content** (no glass cards). This is Apple's own Liquid Glass rule (`liquid-glass.md`, `materials.md`). A `prefers-reduced-transparency` fallback swaps in solid surfaces. |
| Violet + electric blue | **One colour = one meaning.** Electric blue is *the* accent (actions, selection, focus). Violet is a **signal**, not a decoration: it means only "an LLM is thinking right now" (active node pulse, streaming caret). The result reads as purposeful, not as a purple AI template. |
| Gradients, glows | None at rest. The one allowed exception is the faint moving highlight on an **active** edge during a run, because it carries meaning. |
| Cards everywhere | Surfaces are separated by tone steps, not borders or shadows. Shadows only on things that float. |
| Typography | **Geist Sans** for everything. Large tight display type on the landing page (tracking −0.03em, leading 0.95). Two or three working sizes in the app. Monospace **only** for real code, JSON payloads and IDs inside log viewers. No uppercase tracked labels, no eyebrow chips, no 01/02/03 numbering. |

### Tokens (dark-first; light mode follows later from the same roles)
| Role | Hex | Contrast vs ground |
|---|---|---|
| `--ground` | `#0A0B0D` | — |
| `--surface-1` | `#111317` | tone step |
| `--surface-2` | `#171A1F` | tone step |
| `--surface-3` | `#1E2128` | hover / selected |
| `--ink` | `#EDEEF0` | ≈ 17:1 |
| `--ink-2` (secondary) | `#9EA3AD` | ≈ 7.5:1 |
| `--accent` electric blue | `#4C8DFF` | ≈ 6.2:1 |
| `--thinking` violet (signal only) | `#A88BFA` | ≈ 7:1 |
| `--ok` / `--warn` / `--fail` | `#3FCF8E` / `#F5B544` / `#F2555A` | all ≥ 4.5:1 |
| `--glass` | `rgb(23 26 31 / 0.72)` + `backdrop-filter: blur(20px) saturate(140%)` | floating layer only |

Radius: 10px for controls and 14px for panels, applied the same everywhere. Motion: 160ms for UI feedback and 240–320ms for layout, using `cubic-bezier(0.2, 0.8, 0.2, 1)`, with a full `prefers-reduced-motion` fallback. Status is always shown with an icon or label plus colour, never colour alone.

### Screens
**Landing (a page; follows the tasteskill page run):**
- First screen: the h1 **"Intelligence that gets work done."** (33 characters, fits two lines at every width). One plain sentence follows: *"Draw a team of AI agents, connect your documents, and watch them research, analyse, act and review — live."* One button: **Open the app**.
- Hero image: a **real, recorded run** replayed in the actual canvas component, taking about 50% of the first screen. Nodes light up, violet marks the thinking agent, tokens stream into the inspector and citations resolve.
- **Live thing:** type a question in the hero and pick one of three sample documents. The recorded run for that pick plays back. (A static frame is the no-JS fallback.)
- Sections follow the argument, not a stock template: *Draw it* (canvas crop) → *Ground it* (KB with a real citation popover) → *Approve it* (the human-in-the-loop sheet) → *Watch it* (monitoring timeline and Kafka lane) → *Built on* (LangGraph, Kafka, pgvector, FastAPI as a plain list, not logo soup) → closing CTA → footer with the wordmark at full width.
- No eyebrows, no icon-card rows, no testimonials or logos we don't have.

**App shell (an app screen; follows the tasteskill `--app` run):** a collapsible sidebar (icons + labels, 2 levels max, ⌘B), a workspace switcher at the top, and a top bar with breadcrumb, ⌘K and a run status pill. Content sits on `--ground`, panels on `--surface-1`.

- **Dashboard:** real metrics only (runs, success rate, p50/p95 duration, tokens), a recent runs table, an agent activity stream (live via SSE) and system status (Postgres, Kafka, Redis, LLM provider from `/health/config`).
- **Builder:** a full-bleed canvas; a palette of four agent nodes (drag or press `1`–`4`); animated edges while running; a glass inspector sheet on the right (instructions, model, temperature, tools, max revisions); a validation strip; Run, Stop and Re-run controls; a live step timeline docked at the bottom.
- **Playground:** an agent picker, a streaming chat, tool-call chips that expand to JSON, citations and session history.
- **Knowledge base:** a drop zone, a document list with live status (parsing → embedding → ready), metadata, and a search box that shows ranked chunks with scores and a highlighted match.
- **Monitoring:** a run timeline (Gantt of steps), per-agent latency and failure rates, a Kafka lane (topic throughput, consumer lag, DLQ with replay), and an error log with retries.
- **Every screen** has designed loading (skeletons shaped like the content), empty (a next action), error (what happened and how to fix it) and success states.

---

## 7. Security & reliability checklist

JWT access tokens (15 min) plus refresh tokens in httpOnly cookies · bcrypt/argon2 · workspace scoping enforced in the repository layer · Pydantic validation on every input · upload limits checked by size, MIME and magic bytes · per-user rate limits (Redis) · a tool allowlist with `destructive` flags that need approval · `http_get` domain allowlist (SSRF guard) · timeouts, retries, revision caps and recursion limits · secrets only in `.env` (never in `NEXT_PUBLIC_*`) · structured JSON logs with `run_id` and `request_id` correlation · CORS locked to the web origin.

---

## 8. Phases (vertical slices; each one ends green)

Each phase ends with: **tests pass → `docker compose up` works → README updated → a short demo note of what now works.**

| # | Phase | Done when |
|---|---|---|
| 1 | **Foundation**: monorepo (`backend/`, `web/`, `infra/`), Compose with Postgres+pgvector, Redis, Kafka (KRaft), api, worker, projector, web; settings, logging, health endpoints; Next.js shell with design tokens + Geist | `docker compose up` gives healthy containers; `/health` is green; the web shell renders with tokens |
| 2 | **Data & auth**: models, Alembic migrations, register/login/refresh, workspaces, protected routes on web, login/register screens (designed, not placeholder) | A user can register, log in, see their workspace; auth tests pass |
| 3 | **Orchestration core**: workflow CRUD, graph compiler + validator, 4 agents with structured outputs, Postgres checkpointer, guards; runs triggered directly (sync path) for now | A seeded template runs end-to-end against a real LLM; steps are persisted; unit tests use the fake model |
| 4 | **RAG**: upload → parse → chunk → embed → hybrid retrieval → `/ask` with citations; Research agent uses `kb_search` | Upload a PDF, ask a question, get a cited answer; the agent run cites chunks |
| 5 | **Kafka**: outbox and relay, command topic drives the worker, lifecycle events, projector, idempotency, DLQ, ingestion moved to async | A run is triggered only via Kafka; killing the worker mid-run and restarting resumes from the checkpoint; integration tests use testcontainers |
| 6 | **Frontend product**: tasteskill app draw → app shell, ⌘K, Builder (compiles and runs), Playground, KB, approval sheet; then tasteskill page run → landing page | All acceptance criteria are clickable in the UI; `inspect.mjs` shows 0 FAIL on the landing page |
| 7 | **Real-time & monitoring**: SSE with replay, live canvas, dashboard metrics, Monitoring (timeline, Kafka lane, DLQ) | Two browser tabs show the same live run; the dashboard numbers match DB queries |
| 8 | **Hardening & delivery**: Playwright e2e of the 10 acceptance criteria, screenshots, `apple-design` + tasteskill review pass with fixes, architecture diagram, API docs, README, `.env.example` | `make test` and `make e2e` are green; screenshots are in `docs/screenshots/` |

---

## 9. Acceptance criteria (each one has an automated check)

1. Register and log in → e2e.
2. Create and save a workflow on the canvas → e2e + API test.
3. Several agents collaborate through LangGraph, including a reviewer revise loop → integration test.
4. Upload a document → e2e.
5. RAG retrieves relevant chunks → retrieval test with a fixture corpus and expected top-k.
6. Agents use the retrieved context (citations present in the output) → integration test.
7. Kafka processes the lifecycle events (outbox → topic → projector → DB) → testcontainers test.
8. The UI shows live updates → Playwright waits for streamed step states.
9. Execution logs are persisted and replayable → API test.
10. Everything runs from `docker compose up` → CI-style smoke script.

---

## 10. Deliverables

Source (`web/`, `backend/`), `docker-compose.yml`, Alembic migrations, `.env.example`, OpenAPI at `/docs`, `docs/architecture.(svg|png)`, `README.md` (setup on Windows/macOS/Linux, provider setup including free local Ollama), test suites, `docs/screenshots/`.

---

## 11. Defaults chosen (change any of them before Phase 1)

- **LLM:** configurable. Default `openai:gpt-4.1-mini`-class model plus `text-embedding-3-small`. `LLM_PROVIDER=ollama` runs fully local for free (the `ollama` compose profile).
- **Package managers:** `uv` (Python) and `pnpm` (web).
- **Repo:** single git repo, monorepo folders, no Turborepo.
- **Deployment target:** Docker Compose locally. Cloud deploy is out of MVP scope.
