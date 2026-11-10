# Load test results and capacity model

**Read this first.** Sections 1-7 are **measurements** taken on one small shared sandbox VM. Section 8 is a
**model** (arithmetic on assumptions), not a measurement. **Real AI providers (Bedrock, OpenAI, Anthropic) were never
loaded**: every AI number here uses the in-process mock provider, so provider latency, provider quotas and token cost
are not measured anywhere in this document.

The measured numbers are a relative baseline for this codebase on this machine. They do not transfer to AWS Fargate/RDS
by a fixed ratio.

## 1. Environment

| Item           | Value                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Machine        | 2 vCPU, 7.8 GB RAM, Linux, Node v22.23.4, PostgreSQL 16 + pgvector 0.6.0 and Redis, **all on the same VM**                                 |
| Shared with    | the load generator, 1 API process, 1 workers process, Postgres, Redis (all compete for the same 2 vCPU)                                    |
| Noise          | other engineers' test/build runs shared the VM. One run saw load average 6.3. See "Reliability" below                                      |
| API under test | `apps/api` built `dist`, `NODE_ENV` not production, `LOG_LEVEL=warn`, `DB_POOL_MAX=10` (the previous hardcoded 10)                         |
| Workers        | `apps/workers` built `dist`, `WORKER_CONCURRENCY=5` (ai-tasks queue concurrency = ceil(5/2) = 3)                                           |
| AI provider    | mock provider only (`AI_ALLOW_MOCK_PROVIDER=true`), mock 1536-d embeddings                                                                 |
| Database       | separate DB `hilatech_load` created from the repo migrations (about 448 MB after seeding). `hilatech` and `hilatech_test` were not touched |
| Redis          | db 7, BullMQ prefix `bull-load`, API on :4150, workers health :4151                                                                        |

**Dataset** (`tests/load/seed.ts`, then `tests/load/seed-long-threads.mjs`): 6 organizations (20k/10k/8k/5k/4k/3k
leads = 50,113 leads), 50k contacts, 19,955 conversations, 459,775 messages (the 400 most recent conversations per
organization have about 500 messages each), 11,000 knowledge chunks, 140 users, an agent, a webhook endpoint.

**Throttling.** Per-IP throttling would reject a single-IP load generator. The load stack raises the limits only through
environment variables (`RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`, `WEBHOOK_RATE_LIMIT_MAX`, in `tests/load/load.env`).
Code defaults are unchanged (120 / 10 / 120 per 60 s per IP). The 429 behaviour of the defaults was **not run** in
this pass. Production capacity for a single IP (office NAT, mobile carrier NAT) is therefore limited by these defaults, not
by the numbers below.

## 2. Method

- Harness: `tests/load/` (a small `undici` closed-loop runner, `run.mjs`; no k6/autocannon installed). Each stage runs
  N virtual users sending requests back to back for `--duration` seconds after a warmup, and records RPS, latency
  p50/p95/p99, status codes, and a 1 Hz sampler of CPU and RSS for the API, workers, Postgres, Redis and generator,
  and Postgres connection counts (`pg_stat_activity`).
- "Closed loop" means latency rises with concurrency; RPS at the saturation stage is the capacity number, the lower
  stages show latency before saturation. Stage durations are short (12 s), so tails (p99) are indicative only.
- Queue scenarios enqueue a burst (`--burst`) and poll until drained: they report enqueue rate, peak depth (waiting +
  active), time to drain after the last enqueue, and queued-to-finished latency from the database timestamps.
- Reproduce:

```
cd packages/database && ./node_modules/.bin/tsx ../../tests/load/seed.ts      # about 20 s
node tests/load/seed-long-threads.mjs
tests/load/stack.sh start                      # API :4150 + workers, hilatech_load, redis db 7
node tests/load/run.mjs --list
node tests/load/run.mjs --all --duration 12 --warmup 3 --tag final
node tests/load/run.mjs --scenario agent_async --burst 600
node tests/load/run.mjs --scenario webhook_ingest --burst 2000
tests/load/stack.sh stop
```

Raw JSON is in `tests/load/results/`. Other tools: `explain.mjs` (EXPLAIN ANALYZE of captured queries),
`query-count.mjs` (statements per request), `dashboard-diff.mjs` (old/new output equality), `ab.sh` (alternating A/B
of two builds), `pool-sweep.sh`.

## 3. Measured results (final build, all fixes below included)

Single API process (about 1 core available to it), 0 errors in every stage. "API CPU ms/req" and "PG CPU ms/req" are CPU
time per request derived from the sampler; they are the input to section 8.

| Scenario (stage VUs)               | RPS | p50 ms | p95 ms | p99 ms | API CPU ms/req | PG CPU ms/req | Note                                     |
| ---------------------------------- | --- | ------ | ------ | ------ | -------------- | ------------- | ---------------------------------------- |
| auth login (16)                    | 71  | 218    | 298    | 323    | 25-30          | 2             | argon2 hashing; the API CPU is the limit |
| auth refresh (8)                   | 259 | 30     | 44     | 53     | 3.6            | 2             |                                          |
| dashboard analytics (10)           | 110 | 90     | 119    | 133    | 4.2            | 12            | Postgres bound (PG about 130-150% CPU)   |
| dashboard analytics (50)           | 95  | 522    | 582    | 610    | 4.7            | 14            |                                          |
| leads list, paginated (25)         | 196 | 126    | 164    | 180    | 3.7            | 4.3           | API process about 75% CPU                |
| leads list (100)                   | 179 | 560    | 643    | 676    | 4.3            | 4.3           |                                          |
| leads search (10)                  | 46  | 211    | 385    | 429    | 3.8            | 33            | Postgres bound, linear in rows per org   |
| leads search (25)                  | 43  | 583    | 755    | 833    | 4.2            | 36            |                                          |
| contacts list (10)                 | 315 | 31     | 43     | 51     | 2.8            | 1.9           |                                          |
| contacts search (10)               | 94  | 100    | 188    | 244    | 3.2            | 17            |                                          |
| conversations list (25)            | 207 | 119    | 150    | 166    | 3.9            | 3.3           |                                          |
| knowledge search, mock embed. (25) | 218 | 113    | 145    | 175    | 4.0            | 2.7           | 11k chunks only; HNSW index              |
| assistant message, JSON (25)       | 74  | 330    | 413    | 446    | 9.0            | 14            | 28 statements per turn, mock provider    |
| assistant message, SSE (25)        | 67  | 366    | 455    | 521    | 9.6            | 16            |                                          |
| webhook ingest, sync part (25)     | 217 | 114    | 153    | 171    | 2.5            | 3.9           | hot-row `UPDATE` of the endpoint counter |

Process memory (RSS), API: about 400 MB idle, 690-790 MB after the full plan (no growth after the mock-provider fix,
section 5).

**Queue throughput** (isolated runs, empty queue before the run, 20 concurrent enqueuers):

| Scenario                          | Enqueue rate | Peak depth | Drain after last enqueue | Processing rate | Queued -> finished p50 / p95 / p99 | Job run p50 |
| --------------------------------- | ------------ | ---------- | ------------------------ | --------------- | ---------------------------------- | ----------- |
| agent execute async, 600 jobs     | 69 jobs/s    | 175        | 1.3 s                    | 60 jobs/s       | 1.5 s / 2.3 s / 2.5 s              | 30 ms       |
| webhook inbound -> workflow, 2000 | 209 jobs/s   | 1,254      | 10.5 s                   | 100 jobs/s      | 7.1 s / 10.0 s / 10.3 s            | 33 ms       |

Mock provider runs take 30 ms, so these rates measure queue and database overhead, **not** real agent execution (a real
model call takes seconds; see section 8). One workers process was used (ai-tasks concurrency 3, automation concurrency 5).
The 100 jobs/s webhook processing rate is below the 209 jobs/s the API accepts, so **a sustained inbound webhook rate
above about 100/s grows the queue without bound** on one workers process (the queue absorbs bursts, it does not
fix a sustained excess). In the full-plan run the previous scenario's leftover backlog (4,371 jobs) was still draining
and the numbers (agent 34 jobs/s, webhook 39 jobs/s) were visibly worse; they are kept in
`tests/load/results/all-final-*.json` but are not used here because they are contaminated.

**DB connection pool sweep** (`DB_POOL_MAX` 5 / 10 / 20, 10 s each, single run each, so differences under about 10% are noise):

| Scenario (VUs)           | pool 5 RPS (p50) | pool 10 RPS (p50) | pool 20 RPS (p50) |
| ------------------------ | ---------------- | ----------------- | ----------------- |
| dashboard (25)           | 82 (303)         | 87 (284)          | 84 (288)          |
| leads list (50)          | 162 (304)        | 167 (296)         | 180 (276)         |
| assistant JSON (25)      | 70 (343)         | 66 (373)          | 72 (343)          |
| webhook ingest sync (50) | 221 (221)        | 221 (221)         | not run           |

On a 2 vCPU host the pool size does not matter in this range: Postgres CPU is the limit, not connections. Pool 40 was
not run. The pool size matters for **connection arithmetic** (tasks x pool, section 8), which is why it is now
configurable (`DB_POOL_MAX`, default unchanged at 10).

**Not run in this pass:** `WORKER_CONCURRENCY` sweep, default-limit 429 behaviour, real AI providers, a multi-instance API,
a test longer than 12 s per stage (no soak, so slow leaks other than the one found below are not excluded), pgvector at
production scale (11k chunks only).

## 4. Bottlenecks found

1. **Postgres CPU is the first limit on data-heavy endpoints.** Dashboard, search and assistant turns all drive Postgres
   to 100-170% of the 2 vCPU; the API process stays at 40-65%. Light list endpoints hit the API's single Node core
   (about 75-90% CPU, 3-4 ms CPU per request) first.
2. **Search is O(rows in the organization).** Lead search `COUNT` (two LEFT JOINs to `Contact`, `ILIKE` over several
   columns) takes 80 ms at 20k leads in isolation and about 190 ms under load; contacts search `COUNT` 36 ms (79 ms under load). The page
   query is fast; the total count is the cost. Deep offset paging (skip 19,000) 43 ms.
3. **Conversations list and `get` over-fetched messages.** The Prisma include `messages: { take: 1 }` loaded **all** messages
   of each conversation (no `LIMIT` is generated). With 500 messages per conversation, 10k message rows cost 26.8 ms
   vs 1.4 ms for a `LATERAL ... LIMIT 1` read.
4. **Dashboard did 21 queries per request** (many `count`/`groupBy` over the same tables).
5. **AI usage summary loaded every request-log row of the period into memory** (unbounded).
6. **Per-AI-request budget check runs four aggregates over the month's rows** (`SUM(UsageRecord)`, `AiRequestLog`
   sum/count); each is 2-8 ms now but grows linearly with monthly rows (UsageRecord: 16k rows = 5.5 ms).
7. **Memory leak in the mock provider** (it recorded every request forever): API RSS grew 619 -> 1218 MB in 200 s at
   about 77 rps.
8. **Webhook ingest has a hot row** (`receivedCount` on the endpoint); it caps one endpoint at the speed of serial updates
   (about 200 rps here, not a problem at design volumes).
9. **The auth guard costs about 4 queries per request** (user, session, membership, role); the session check added by the
   security work is included in the final numbers (it adds one indexed query per request).
10. Notification de-duplication in the workers uses a JSON-path query that is O(the user's notifications)
    (2.8 ms at 13k notifications).

## 5. Fixes made (small, additive; no index migration)

| Fix                                                                                                                    | Files                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Dashboard: 21 -> about 10 queries (consolidated `GROUP BY` / `COUNT FILTER`); output verified identical on 42 captures | `apps/api/src/modules/analytics/analytics.service.ts`                                                        |
| Conversations: last message read with `LATERAL ... LIMIT 1` instead of loading all messages                            | `conversations.service.ts`, `conversations.mappers.ts`, `conversations.service.spec.ts`                      |
| AI usage summary: `groupBy` in the database instead of all rows in memory (`UsageRow.requests` weight)                 | `ai/usage/ai-usage.service.ts`, `ai/usage/usage-summary.ts`, `usage-summary.spec.ts` (new weighted-row test) |
| Budget: cost aggregates skipped unless a cost budget is enforceable; reconcile does not compute detail                 | `apps/api/src/modules/billing/budget.service.ts`                                                             |
| Mock provider keeps at most 200 recorded requests (memory plateau about 740 MB instead of unbounded)                   | `packages/ai-engine/src/providers/mock.ts`                                                                   |
| `DB_POOL_MAX` env var (default 10, unchanged) for API and workers                                                      | `apps/api/src/config/env.schema.ts`, `prisma.service.ts`, workers equivalents, `.env.example`                |

**A/B (alternating runs of old vs new build, 2 rounds, long-thread dataset; "old" and "new" differ only in `apps/api` code):**

| Scenario (VUs)           | Old RPS (p50 ms)      | New RPS (p50 ms)                   |
| ------------------------ | --------------------- | ---------------------------------- |
| dashboard (25)           | 52.6 / 50.7 (476-489) | 97.2 / 83.9 (255-293)              |
| conversations list (25)  | 122 / 124 (about 202) | 198 / 202 (about 122)              |
| assistant JSON (25)      | 68 (354-359)          | 84-87 (281-291)                    |
| leads list (25), control | 188 / 178             | 172 / 195 (unchanged, as expected) |

Statements per request: dashboard 25 -> 14, assistant turn 30 -> 28 (database time per turn 18-20 ms -> 8 ms).
The dashboard-at-5-VUs case showed no clear difference (70/65 -> 74/90, within noise).

**No index migration was added.** Trigram indexes cannot be used by Prisma-generated search queries (`citext` email, `OR`
across five columns), and a single-join rewrite gave only 20-25%. Because no migration was created, nothing had to be
applied to `hilatech`/`hilatech_test`. The recommended next step for search at scale is `pg_trgm`/full-text search with a
raw query, planned as its own change.

**Not fixed (documented):** the notification de-duplication JSON-path query (an expression index is not expressible in the Prisma schema); the
per-AI-request monthly aggregates (fine at 10^4 rows, should become a maintained counter at 10^6); search `COUNT` cost.

## 6. Verification of the changes

All run after the final changes (Postgres template copy `perf_test` of `hilatech_test`, Redis db 10, prefix
`bull-test-perf`, dropped afterwards):

| Check                                           | Result                    |
| ----------------------------------------------- | ------------------------- |
| `tsc --noEmit` apps/api, apps/workers           | clean                     |
| eslint on changed API areas, workers, ai-engine | clean                     |
| apps/api unit tests (`jest -c jest.config.ts`)  | 35 suites, 231 tests pass |
| apps/api integration tests (`--runInBand`)      | 27 suites, 359 tests pass |
| apps/workers unit / integration                 | 85 / 46 tests pass        |
| packages/ai-engine (`vitest run`)               | 91 tests pass             |

## 7. Reliability of these numbers

- Single runs of 10-12 s per stage on a shared VM. Repeated runs of the same stage varied by roughly +-10% RPS; noisy
  runs (other agents building) were up to 2x worse (agent drain 24 jobs/s vs 66 jobs/s). Treat differences under 10% as noise.
- Generator, API, workers, Postgres and Redis share 2 vCPU, so every number is a **lower bound** on what each component
  could do alone, and loopback networking makes latency optimistic compared with a real network.
- The A/B comparisons were alternated to cancel drift; the full-plan table is a single pass.

## 8. Extrapolation to the 50,000 DAU design target - MODEL, NOT MEASUREMENT

Nothing in this section was measured at 50,000 users. It multiplies measured per-request CPU costs (section 3) by
**assumed** traffic. Change the assumptions and the answer changes proportionally.

### 8.1 Assumptions (all invented for the model)

| Assumption                                  | Value                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| DAU                                         | 50,000                                                                                                                          |
| Peak-hour active users                      | 20% of DAU = 10,000                                                                                                             |
| API requests per active user in peak hour   | 120 (one every 30 s: page loads, list refreshes)                                                                                |
| Mix of those requests                       | 17 AI chat turns/s are carved out below; the rest is light reads at about 3.5-4 ms API CPU, of which 5% dashboard and 3% search |
| AI chat turns per active user in peak hour  | 6 (one per 10 min) -> 10,000 x 6 / 3600 = 16.7 turns/s (about 1,000/min)                                                        |
| Agent executions per active user, peak hour | 2 -> 10,000 x 2 / 3600 = 5.6 executions/s (333/min)                                                                             |
| Real model latency per agent execution      | 8 s (an assumption; **not measured**, mock was 30 ms)                                                                           |
| Tokens per AI chat turn / agent execution   | 2,500 in + 500 out / 3,000 in + 800 out (assumptions)                                                                           |
| Logins in the peak hour                     | 10,000 (every active user logs in once) = 2.8/s                                                                                 |
| Per-task capacity                           | 1 Fargate vCPU is assumed equal to one core of this VM (**unverified; could be 0.5x-2x**)                                       |

### 8.2 Arithmetic

API requests: 10,000 x 120 / 3,600 = 333 rps total, of which 16.7 AI turns/s and 316 other requests/s.

API CPU (from section 3): 316 x 4 ms = 1.26 core-s/s; AI turns 16.7 x 9.5 ms = 0.16; logins 2.8 x 27 ms = 0.08.
Total about **1.5 cores of API CPU at peak**. At the production target-tracking CPU of 55% (`infra/cdk/lib/config.ts`: 1024 CPU
units = 1 vCPU per task, 2-10 tasks): 1.5 / 0.55 = 2.7, so about **3 API tasks** (the configured minimum is 2, maximum 10;
a 2x error in the per-core assumption gives 3-6 tasks). API memory: about 400-800 MB per process, which fits the 2 GB task.

Postgres CPU (from section 3): 316 requests/s at an average of about 4.5 ms (3.5 ms light reads, 14 ms dashboards for 5%, 33 ms searches
for 3%) = 1.4 core-s/s; AI turns 16.7 x 14 ms = 0.23; agent executions 5.6/s x about 40 statements, roughly 15 ms = 0.08.
Total about **1.7 cores of Postgres CPU at peak** on this machine's CPU.

Connections: API tasks x `DB_POOL_MAX` (3-6 x 10 = 30-60) plus workers tasks x pool (2-4 x 10 = 20-40) = **50-100 connections**.
RDS `max_connections` depends on instance memory (the default formula is roughly memory / 9.5 MB; for 4 GB that is about
400, verify on the instance); this is fine at 100 but each new task adds 10, so at 10 API tasks + 10 workers tasks the pool
would need `DB_POOL_MAX` lowered or an RDS Proxy.

Agent executions (the part most likely to be wrong): each execution holds a worker slot for the model latency. Slots needed =
5.6/s x 8 s = **45 concurrent executions**. The ai-tasks queue runs ceil(`WORKER_CONCURRENCY`/2) = 3 jobs per workers
process at the default 5, so 45 / 3 = **15 workers tasks** at defaults, or 2-3 tasks at `WORKER_CONCURRENCY` = 30 (15 slots each). Workers CPU is
not the constraint for real executions (mock execution used 47% of a core at 60 jobs/s, about 8 ms CPU per job); concurrency
settings and provider quotas are. Measured mock throughput of 60 jobs/s must not be read as real throughput: it was
measured with 30 ms jobs.

Inbound webhook/automation: measured processing about 100 jobs/s per workers process on a shared 2 vCPU box; the design volume is
not stated, so no conclusion beyond: a sustained inbound rate above about 100/s per workers task grows the queue (section 3).

### 8.3 Result of the model (summary)

| Component                | Model estimate at 50,000 DAU peak hour                                                                                                                                                                                                                           | Confidence                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| API tasks (1 vCPU)       | about 3 (range 3-6)                                                                                                                                                                                                                                              | medium-low (CPU-per-core assumption)      |
| Postgres CPU             | about 1.7 cores of this VM's speed -> the prod `t4g.medium` (2 vCPU burstable, sustained baseline about 20% per vCPU = 0.4 core) **would be exhausted** at peak; plan a non-burstable class of at least 4 vCPU and read replica or caching for dashboards/search | medium; this is the first real bottleneck |
| DB connections           | 50-100                                                                                                                                                                                                                                                           | medium                                    |
| Workers tasks for agents | 2-3 (at `WORKER_CONCURRENCY`=30) or 15 (at defaults)                                                                                                                                                                                                             | low (depends on real model latency)       |
| Redis                    | not measured as a limit (under 7% CPU at 200 jobs/s)                                                                                                                                                                                                             | medium                                    |

### 8.4 What does not scale with ECS tasks

- **The database is a single writer.** Adding API/workers tasks adds connections and load on the same Postgres; throughput
  stops improving once Postgres CPU is saturated (measured: it was at 100-170% on this box for the dashboard, search
  and assistant paths while the API process was only 40-65% busy). Scale it vertically, move reads to a replica, and fix
  the O(rows) queries first.
- **Provider quotas.** At the assumed token volumes (16.7 x 3,000 + 5.6 x 3,800 about 71,000 tokens/s, about 4.3M tokens/minute) the account
  quota of the model provider (requests and tokens per minute) is likely to be hit long before CPU is; throttling returns
  `rate_limited` and the orchestrator retries within budget. Quotas were never exercised.
- **Cost.** Token spend scales linearly with usage regardless of task count and is the largest variable cost (see
  `cost-model.md`); this model contains no prices. The monthly AI budget enforcement scans the month's rows
  per request and needs a counter at this scale (section 5, not fixed).
- **Per-IP rate limits** (120 requests/60 s default) apply per client IP, not per task; many users behind one NAT would be
  limited long before capacity.
- **Hot rows** (webhook endpoint counter) serialize regardless of task count.

### 8.5 How to turn this model into a measurement

Run the harness against a staging stack with production-sized tasks and RDS, a separate load-generator host, the
real provider with a capped budget, and a 30-60 minute soak at the section 8.1 rates; then replace the assumed per-core and
latency figures with measured ones.
