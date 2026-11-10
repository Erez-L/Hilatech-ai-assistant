# Implementation Plan

Part 1 records what each delivery phase (P1–P6, numbered as the roadmap's "priorities") actually contained, taken from the
git history and the code. Part 2 proposes the next phases with rationale. Gap references (A/B/C) point to
[gap-analysis.md](./gap-analysis.md); per-feature status is in [feature-matrix.md](../product/feature-matrix.md).
Commit dates span 2026-11-09 to 2026-11-10 (the initial migration is stamped 2026-11-08).

## Part 1 — What was built

### P1 — Working SaaS foundation (commits `a5b4960`, `d095cbc`, `8236479`, `77a00fd`)

- Monorepo (pnpm + Turborepo), shared configs, Docker Compose (Postgres+pgvector, Redis), Dockerfiles, GitHub Actions CI.
- `packages/contracts` (zod schemas, permission keys, error codes, queue payloads), `packages/database` (Prisma 7 schema, initial migration, seed with demo organization), `packages/shared`, `packages/types`.
- `apps/api`: bootstrap (env validation, pino, helmet/CORS, zod pipe, error envelope, Swagger, throttling, health), auth with refresh rotation and family revocation, organizations, members, roles/permissions, invitations, audit, billing-readiness skeleton, tenant guards.
- `apps/workers`: BullMQ infrastructure, email (log/smtp), notifications, analytics (daily roll-up logging), health endpoint, stubs for later queues.
- `apps/web` + `packages/ui`: design system, API client with silent refresh, auth pages, onboarding, app shell, dashboard, team, roles, audit, settings (organization, profile, billing).
- Tests: cross-tenant, permission, token and leak suites; Playwright `critical-journey`.

### P2 — Core business (commits `96b8412`, `8508692`, `3dbda20`)

- Contacts, leads (notes, activities, assignment, conversion), conversations and messages, notifications with preferences, live dashboard analytics.
- Web: leads, contacts, conversations inbox, notification bell, dashboard; new UI primitives (Combobox, TagInput, SegmentedControl, Timeline, AreaChart, AutosizeTextarea).
- Tests: CRM integration suites, `security/crm-cross-tenant`, Playwright `crm-journey`.

### P3 — AI platform (commits `1d70aad`, `8532725`, `131d39f`, `86e5fcd`, `7424538`)

- `packages/ai-engine`: provider interface with Anthropic, OpenAI and mock adapters, context builder, tool registry with permission layer, `AgentRunner` with budgets and delegation, usage recording.
- API: providers (encrypted keys), usage, prompt templates, tool catalogue, assistant threads with SSE, agents and executions (sync/async/cancel).
- Workers: `ai-tasks` consumer (async executions, conversation summaries, Redis cancellation, user permission resolution).
- Web: Assistant, Agents, Executions, Settings → AI. Tests: `ai-cross-tenant`, assistant/agents suites, `ai-journey` e2e. **Mock provider only.**

### P4 — Knowledge, automation, integrations (commits `21477de`, `22e6ac8`, `73e3792`, `4205c76`, `2318953`, `ca64664`)

- `packages/storage` (local and S3 drivers, tenant-prefixed keys), knowledge pipeline (extract, chunk, embed, pgvector HNSW), `/knowledge/search` and the `knowledge.search` tool.
- Workflows (4 triggers, 10 step types, runner, cron scheduler, templates), domain events, inbound and outbound webhooks (HMAC, SSRF guard, retries), integration framework (REST, n8n live; email/WhatsApp/CRM catalogue only).
- Web: knowledge, automations (editor, templates, executions, webhooks), integrations. Tests: knowledge/automation suites and cross-tenant suites, `knowledge-automation-journey` e2e.

### P5 — Commercial capabilities (commits `ca64664`, `8df1380`)

- Analytics reports (business, sales from leads, agents, automation, usage) with CSV export; entitlements overview; plan catalogue; upgrade options; per-organization AI budget with hard-stop admission control and alerts; checkout contract returning 501.
- Web: Analytics (5 tabs) and Billing (entitlements, upgrade options, budget, alerts). Test: `analytics-billing-journey` e2e, `security/analytics-billing-cross-tenant`.
- **Not done**: payments, enforcement of `agents`/`automations` limits, worker-side budget re-check.

### P6 — Production readiness (partially done: commits `8df1380`, `ea9ff7d`; documentation pass 2026-11-10)

Done:

- Amazon Bedrock provider adapter (mock-SDK tests), AWS CDK v2 app (network, registry, data, app, ops; cdk-nag; 37 assertions), `infra.yml` validate-only workflow and a disabled approval-gated `deploy-aws.yml`.
- Operations documents: AWS architecture, capability matrix, AgentCore decision, cost model, runbooks, SLOs, backup/recovery, AWS setup guide (English and Hebrew).
- Product, design and architecture documentation completed on 2026-11-10 (this set).
  Not done / owned elsewhere: security review and load-test results (separate workstreams, not assessed here), any real deployment, container image builds, backup/restore rehearsal, monitoring in a live environment, regression-test automation in CI for e2e.

## Part 2 — Recommended next phases

Ordering principle: first make what exists **provably true** and safe to show; then close the gaps that decide adoption; then
monetize and scale; then differentiate. Sizes are for one engineer (see gap-analysis for scale).

### Phase 7 — Pilot readiness (≈ 2 weeks)

| Work                                                                                     | Gap     | Why first                                                       |
| ---------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| Reconcile landing-page copy with reality (or build A1 first)                             | C14     | Public text currently promises customer channels                |
| Run e2e in CI against a compose stack; fix integration-run flake                         | C1, C2  | Every later change needs a trustworthy safety net               |
| Complete and act on the security review; shared-store rate limiter                       | C10, C6 | Multi-tenant product with app-level isolation only              |
| Build and run the Docker images; first AWS deploy to a dev account (see aws-setup-guide) | B8, B7  | Nothing has run outside the authoring machine                   |
| Verify live providers and SMTP with real keys; fix what breaks; set `AI_PRICING_JSON`    | B1, B3  | All AI evidence is from the mock provider                       |
| Browser pass over screens listed in gap C3 plus dark mode, mobile width and an axe run   | C3, C4  | Visual claims are currently unverified                          |
| CSV import/export for contacts and leads                                                 | A2      | Top onboarding blocker for any real business with existing data |

### Phase 8 — Close product promises (≈ 4–6 weeks)

| Work                                                                                                                 | Gap    | Rationale                                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| Web chat widget + public conversation endpoint + AI auto-reply with hand-off to a human, budget and permission rules | A1     | The central promise; web channel has no third-party dependency, so it can be built and verified fully |
| Email verification enforcement + resend; TOTP MFA                                                                    | A5     | Account security expected by business customers                                                       |
| Enforce `agents`/`automations` limits; worker-side budget admission                                                  | A6, A7 | Removes known cost-control holes before real spend                                                    |
| Hebrew localization and RTL                                                                                          | A4     | Primary user language; do before more screens are added to avoid re-work                              |
| Deals/pipeline/Kanban and Tasks (models, API, UI, workflow steps, analytics)                                         | A3     | Makes the CRM complete enough to replace a spreadsheet                                                |
| Email send step for workflows and the real email integration                                                         | A11    | Closes the "automates follow-up" promise                                                              |

### Phase 9 — Monetize and operate (≈ 3–4 weeks)

| Work                                                                                          | Gap        | Rationale                                                        |
| --------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| Payment provider integration (checkout, webhooks, invoices, plan changes, dunning)            | A14, B4    | Needs an account; internal plan-change service can start earlier |
| Staging/production on AWS with observability, backup/restore and runbook rehearsal, load test | B7, C8, C9 | Turns the documented ops model into a tested one                 |
| Persisted analytics roll-ups only if load tests show need                                     | A19        | Avoid premature complexity                                       |
| Activity center, audit export and retention, remaining CSV exports                            | A8, A16    | Admin completeness                                               |

### Phase 10 — Differentiate (backlog, order by customer demand)

Visual workflow canvas (A10), agent teams and memory (A12), evaluation datasets (A13) — pair with live-provider data from Phase 7,
guardrails (A18), WhatsApp and CRM connectors (B5, B10), platform operator console (A15), OCR and more document types (A17), SSO (A5).

## Working agreements for the next phases

- Every new endpoint ships with a cross-tenant test case in the matching `security/*.int-spec.ts`.
- Status in `task-status.md` changes only with evidence (test name or command output) in the same change.
- Anything that cannot be run here (live provider, SMTP, AWS) is recorded as "not live-tested" until it has been run once with real credentials.
