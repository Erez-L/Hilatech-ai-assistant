# Changelog

All notable changes to this project are documented here. Format: Keep a Changelog; versioning: SemVer.

## [Unreleased]
### Added

- Priority 4 web: knowledge bases with retrieval test, automation editor/templates/executions/webhooks, integrations.
- Priority 5 backend: analytics reports with CSV export, entitlements overview, plans, upgrade options, AI budgets with admission control and alerts.
- Priority 4 backend: knowledge bases with document ingestion (extract, chunk, embed, pgvector search) and the `knowledge.search` agent tool; workflows with a runner and scheduler; inbound/outbound webhooks (HMAC, SSRF guard, retries); integration framework (REST, n8n); domain events.
- Priority 3 AI platform: provider/usage/prompt/tool APIs, streaming AI assistant, agent builder with sync/async executions and inspector, Settings → AI, worker consumer, conversation summaries; mock-provider e2e journey.
- Priority 2 core business: contacts, leads (notes, activities, assignment, conversion), conversations & messages, notifications (in-app + preferences), live dashboard analytics — API modules, web pages (leads/contacts/conversations/dashboard), new UI primitives (Combobox, TagInput, SegmentedControl, Timeline, AreaChart, AutosizeTextarea) and e2e CRM journey.
- AI engine package (`@hilatech/ai-engine`): Anthropic/OpenAI/Mock adapters, context builder, permission-gated tool executor, agent runner with budgets and delegation, pgvector knowledge retrieval helpers; AI-platform database migration.
- Priority 1 foundation: NestJS API (auth with refresh rotation, organizations, members, roles/permissions, invitations, audit, billing readiness, analytics counts), BullMQ workers app, Next.js web app with design-system package; unit, integration, security and e2e suites.
- Priority 1 foundation: NestJS API (auth with refresh rotation, organizations, members, roles/permissions, invitations, audit, billing readiness, analytics counts), BullMQ workers app, Next.js web app with design-system package; unit, integration, security and e2e suites.
- Monorepo skeleton (pnpm + Turborepo), shared config, contracts, shared utilities, types.
- Prisma schema for identity, tenancy, governance, CRM and notifications; seed for permission catalog and demo data.
- Docker Compose (Postgres + pgvector, Redis, app profile), Dockerfiles, GitHub Actions CI.
- Architecture, database, security and API documentation.
