# Changelog

All notable changes to this project are documented here. Format: Keep a Changelog; versioning: SemVer.

## [Unreleased]
### Fixed

- Bedrock replies no longer show the model's inline `<thinking>` text (Amazon Nova writes its reasoning into the answer); it is removed in the provider, for streamed and non-streamed replies.
- The assistant page treated an Amazon Bedrock provider as "AI not configured" because it has no API key; found on the first live deployment.

### Added

- UI polish: pill-style tab bars, tone-coloured empty states and table rows, softer focus ring on inputs.
- Visual redesign (styling only, no behaviour change): per-area colour tones, dark navigation rail with coloured icon tiles, area icon beside page titles, coloured stat tiles and deal-board columns, larger radii, press/hover/enter motion, coloured toast icons, and rounded option lists for native selects in browsers that support customizable selects.

- Email-verification enforcement (`REQUIRE_EMAIL_VERIFICATION`) with `POST /auth/resend-verification` and a verification gate in the web app.
- Per-account login lockout (`LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCKOUT_WINDOW`) and a Content-Security-Policy for the web app.
- Workers re-check the AI budget hard stop before queued agent runs, workflow agent steps, evaluation cases and embeddings.
- Hebrew emails with right-to-left layout; the web app sends its UI language to the API.
- Agent evaluation datasets: `/evaluations` API, `evaluation_run` worker task, Evaluations pages (migration `20261111234833_evaluations`).
- CI builds the three Docker images, applies migrations from the API image and smoke-tests the running containers.

### Documentation

- `docs/operations/aws-growth-guide.he.html`: staged Hebrew guide (preparation, demo on a single server, pilot, launch on the managed stack, scale) with cost estimates per stage.

### Fixed (deployment)

- The ECS migrate task pointed at files the API image did not contain; the image now ships a migration bundle in `/app/migrate`.
- The API syncs the permission catalog on start; a fresh environment no longer needs a seed step.
- Single-host deployment (`docker-compose.prod.yml`): migrate service fixed, Caddy receives `APP_DOMAIN`, shared uploads volume, `IMAGE_REPOSITORY` (lowercase); CI now brings this stack up and checks it.

### Fixed

- CI: packages are built before the database seed; API and workers integration suites run one after the other (they share a database); the repository is Prettier-clean and load-test result files are ignored by Prettier.
- Dependencies: zod 4.6.7 (was 3.25), multer >= 2.5.0, postcss >= 8.5.23 — `pnpm audit --prod` is clean. Validation issue codes in `400 VALIDATION_ERROR` details follow zod 4 (`invalid_format` instead of `invalid_string`).

### Documentation

- Product documents (vision, functional specification, user journeys, feature matrix), design documents (design system, screen specifications), architecture documents (system overview with C4 diagrams, tenant isolation) and development documents (gap analysis, implementation plan) written from the code, with an explicit status per feature (verified / not live-tested / partial / not implemented / externally blocked).
- README, setup, roadmap and task-status corrected: stale "Not Started" rows for the AI, knowledge, automation and commercial areas replaced by their verified state; stale "placeholder routes" claim removed; known `.env.example` inconsistencies recorded.

### Known issues (found while documenting, not fixed in this change)

- `.env.example` lists `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `N8N_WEBHOOK_URL`, `N8N_API_KEY`, but no code reads them.
- Email verification is not enforced and has no resend endpoint; stored organization business hours and branding colour are not applied anywhere.
- Plan limits `agents` and `automations` are reported but not enforced; workers do not re-check the AI budget.
- Organization setting `ai.defaultProvider` accepts only `anthropic` or `openai`.
- The landing page describes customer-channel capabilities that are not implemented.

### Added

- Phase 7: tasks with reminders, companies, pipelines and deals (Kanban, conversion report), CSV import/export, create_task workflow step, AI tools for tasks and deals; Hebrew/RTL localization; tasks/deals/companies/imports UI.
- Priority 6: independent security review with 7 fixes, load-test harness with measured results and query optimizations, product/design/architecture documentation, Hebrew AWS setup guide.
- AWS (unverified, nothing deployed): Amazon Bedrock AI provider adapter (`bedrock`; Converse/ConverseStream/tool use/Titan+Cohere embeddings; IAM credential chain; gated by `AI_BEDROCK_ENABLED`) with a mocked-client test suite, `AiProviderConfig.region` migration, provider-dialog support; AWS CDK v2 app in `infra/cdk` (VPC, ECS Fargate api/web/workers, ALB, RDS PostgreSQL, ElastiCache Redis, S3, Secrets Manager, WAF, Backup, CloudWatch, Budgets; cdk-nag); `infra.yml` validate-only workflow and a disabled, approval-gated `deploy-aws.yml` stub; AWS architecture, capability matrix, AgentCore decision, cost model, runbooks, SLOs, backup/recovery and a step-by-step AWS setup guide.
- Priority 4 web: knowledge bases with retrieval test, automation editor/templates/executions/webhooks, integrations.
- Priority 5 backend: analytics reports with CSV export, entitlements overview, plans, upgrade options, AI budgets with admission control and alerts.
- Priority 4 backend: knowledge bases with document ingestion (extract, chunk, embed, pgvector search) and the `knowledge.search` agent tool; workflows with a runner and scheduler; inbound/outbound webhooks (HMAC, SSRF guard, retries); integration framework (REST, n8n); domain events.
- Priority 3 AI platform: provider/usage/prompt/tool APIs, streaming AI assistant, agent builder with sync/async executions and inspector, Settings → AI, worker consumer, conversation summaries; mock-provider e2e journey.
- Priority 2 core business: contacts, leads (notes, activities, assignment, conversion), conversations & messages, notifications (in-app + preferences), live dashboard analytics — API modules, web pages (leads/contacts/conversations/dashboard), new UI primitives (Combobox, TagInput, SegmentedControl, Timeline, AreaChart, AutosizeTextarea) and e2e CRM journey.
- AI engine package (`@hilatech/ai-engine`): Anthropic/OpenAI/Mock adapters, context builder, permission-gated tool executor, agent runner with budgets and delegation, pgvector knowledge retrieval helpers; AI-platform database migration.
- Priority 1 foundation: NestJS API (auth with refresh rotation, organizations, members, roles/permissions, invitations, audit, billing readiness, analytics counts), BullMQ workers app, Next.js web app with design-system package; unit, integration, security and e2e suites.
- Monorepo skeleton (pnpm + Turborepo), shared config, contracts, shared utilities, types.
- Prisma schema for identity, tenancy, governance, CRM and notifications; seed for permission catalog and demo data.
- Docker Compose (Postgres + pgvector, Redis, app profile), Dockerfiles, GitHub Actions CI.
- Architecture, database, security and API documentation.
