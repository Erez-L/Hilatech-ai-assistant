# Roadmap

Priorities follow the product specification. Status detail per task is in [task-status.md](./task-status.md); what each
phase contained is in [implementation-plan.md](./implementation-plan.md); what is still missing is in
[gap-analysis.md](./gap-analysis.md). Status below was re-checked against the code on 2026-11-12.

| #   | Priority                         | Scope                                                                                                                          | Status                                                                                                                                                                       |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Working SaaS foundation**      | monorepo, API, web, Postgres, Redis, auth, organizations, multi-tenancy, roles/permissions, Docker, CI                         | Done and verified locally and in GitHub Actions CI; the Docker images build in CI but have never been run as containers                                                      |
| 2   | **Core business functionality**  | dashboard, leads, contacts, conversations, team management, notifications, audit logs                                          | Done and verified (API + web + e2e), including companies, deals/Kanban, tasks and CSV import/export. Missing: live customer channels                                         |
| 3   | **AI platform**                  | provider adapters (Anthropic, OpenAI, Bedrock), assistant, agents, tool calling, delegation, usage tracking, prompt management | Done and verified **with the mock provider only**; no live provider call. Evaluation datasets added (deterministic checks). Missing: agent teams UI, memory                  |
| 4   | **Knowledge & automation**       | documents, knowledge bases, embeddings, RAG, background processing, workflows, webhooks, n8n                                   | Done and verified (mock embeddings; n8n against a local stub). Missing: visual canvas, OCR, email/WhatsApp send                                                              |
| 5   | **Commercial SaaS capabilities** | analytics, usage limits, subscription architecture, billing readiness, integration framework, webhooks                         | Done except payments (blocked on a provider) and enforcement of `agents`/`automations` limits; the AI budget hard stop is now also re-checked by the workers                 |
| 6   | **Production readiness**         | security review, performance, monitoring, deployment, backups, documentation, regression tests                                 | **Partial.** AWS CDK, runbooks, SLOs, backup docs written but never exercised; security review and load tests owned by separate workstreams; e2e not in CI; nothing deployed |

## Next

Recommended order (rationale in the implementation plan):

1. **Pilot readiness** — e2e in CI, security review follow-ups, first container build and AWS dev deploy, live-provider and SMTP verification, browser/a11y pass, CSV import/export, landing-page copy.
2. **Close product promises** — web chat widget with AI reply and human hand-off, MFA and email-verification enforcement, limit enforcement, Hebrew/RTL, deals/Kanban/tasks, email workflow step.
3. **Monetize and operate** — payments, staging/production on AWS, load tests, restore rehearsal, activity center.
4. **Differentiate** — workflow canvas, agent teams and memory, evaluation datasets, guardrails, WhatsApp/CRM connectors, operator console.

## Dependency upgrades to evaluate later

Pinned deliberately (ADR-002): Next 15.5, NestJS 11, Prisma 7.10 (already in use, Rust-free driver adapters), TypeScript 5.9, zod 4.6 (upgraded 2026-11-12 for GHSA-mrhx-c7xc-m3w5), BullMQ 5, Tailwind 4.
Candidates to evaluate: Next 16, NestJS 12, Prisma 8 once GA, TypeScript 7 (blocked by `emitDecoratorMetadata` for NestJS DI), BullMQ 6.
