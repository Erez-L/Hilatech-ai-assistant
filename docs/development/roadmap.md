# Roadmap

Priorities follow the product specification. Status detail per task is in `task-status.md`.

1. **Working SaaS foundation** — monorepo, API, web, Postgres, Redis, auth, organizations,
   multi-tenancy, roles/permissions, Docker, CI.
2. **Core business functionality** — dashboard, leads, contacts, conversations, team management,
   notifications, audit logs.
3. **AI platform** — provider adapters (Anthropic, OpenAI), assistant, agents, tool calling,
   orchestration, usage tracking, prompt management.
4. **Knowledge & automation** — documents, knowledge bases, embeddings, RAG, background processing,
   workflows, n8n integration.
5. **Commercial SaaS capabilities** — analytics, usage limits, subscription architecture, billing
   readiness, integration framework, webhooks.
6. **Production readiness** — security review, performance, monitoring, deployment, backups,
   documentation, regression tests.

## Dependency upgrades to evaluate later
Next 16, NestJS 12, Prisma 7 (driver adapters), TypeScript 7, zod 4, BullMQ 6 — see ADR-002.
