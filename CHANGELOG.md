# Changelog

All notable changes to this project are documented here. Format: Keep a Changelog; versioning: SemVer.

## [Unreleased]
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
