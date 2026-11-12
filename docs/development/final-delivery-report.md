# Final Delivery Report

Date: 2026-11-12. Covers the repository at the commit that contains this file.

This report separates what was built and verified from what was built but never exercised against a real service, what is
partial, what was not built, and what is blocked on something outside the repository. "Verified" always means an automated test
that was run and passed on the date above, on the author's machine and, where stated, in GitHub Actions.

## 1. What the product is

A multi-tenant SaaS for small and medium businesses: CRM and sales (contacts, companies, leads, deals, tasks, conversations),
an AI assistant and configurable AI agents, a knowledge base with retrieval, workflow automation with webhooks, analytics, plan
limits and an AI budget, in English and Hebrew (RTL).

Stack: pnpm + Turborepo monorepo, NestJS API, Next.js web app, BullMQ workers, PostgreSQL with pgvector, Redis, Prisma, AWS CDK.

## 2. Implemented and verified

| Area                 | What exists                                                                                                                                                                             | How it was verified                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Accounts and tenancy | Registration, login, refresh-token rotation with reuse detection, sessions, password reset, organizations, invitations, roles and permissions, per-request tenant and session check     | API integration suites (auth, organizations, invitations, members-roles, security/\*)            |
| Account security     | Email verification with resend and optional enforcement, per-account login lockout, per-IP rate limits, audit log                                                                       | `email-verification.int-spec`, `auth.int-spec`                                                   |
| CRM and sales        | Contacts, companies, leads with activities and conversion, deals with pipelines, stages, Kanban board and conversion report, tasks with reminders, conversations, notifications         | API and workers integration suites; Playwright `crm-journey`, `sales-journey`                    |
| Data exchange        | CSV import (dry run, duplicate handling, UTF-8 and Windows-1255, background execution) and CSV export                                                                                   | `data-exchange.int-spec`, workers `sales.int-spec`, `sales-journey`                              |
| AI platform          | Provider adapters (Anthropic, OpenAI, Bedrock, mock), assistant with threads and streaming, agents with tools, delegation and limits, usage and cost tracking, prompt templates         | Unit tests with stubbed SDKs; integration and Playwright `ai-journey` **with the mock provider** |
| Agent evaluation     | Datasets, cases with deterministic checks, runs executed by the workers, per-case results                                                                                               | `evaluations.int-spec`, workers `ai-tasks.int-spec`, Playwright `evaluations-journey`            |
| Knowledge            | Knowledge bases, document upload, extraction, chunking, embeddings, pgvector search, tenant-scoped retrieval                                                                            | `knowledge.int-spec`, workers `document-processing.int-spec` (mock embeddings)                   |
| Automation           | Workflows (events, schedule, manual, inbound webhook), step types including agent runs and task creation, outbound webhooks with signing and retries, SSRF protection                   | `automation.int-spec` (API and workers), Playwright `knowledge-automation-journey`               |
| Integrations         | Framework with encrypted credentials; REST and n8n connectors                                                                                                                           | `automation.int-spec` against a local HTTP server                                                |
| Analytics            | Dashboard, sales, conversations, AI usage, tasks and deals reports, CSV export                                                                                                          | `analytics*.int-spec`, Playwright `analytics-billing-journey`                                    |
| Billing readiness    | Plans, entitlements, monthly AI token and cost budget with alerts and a hard stop enforced by the API (reservation) and re-checked by the workers                                       | `billing-budget*.int-spec`, workers `ai-tasks.int-spec`, `budget-gate.spec`                      |
| Localization         | English and Hebrew UI with right-to-left layout; Hebrew emails                                                                                                                          | `i18n-rtl.spec`, key-parity tests, `email-templates.spec`                                        |
| Tenant isolation     | Every tenant-scoped route rejects access from another organization                                                                                                                      | `security/*-cross-tenant.int-spec` (API), workers cross-tenant cases                             |
| Build and CI         | Lint, formatting, typecheck, unit and integration tests, dependency audit, three Docker images built, migrations applied from the API image, the three containers started and exercised | GitHub Actions `CI` workflow (see section 7 for the last run)                                    |

Test totals on 2026-11-12 (author's machine):

- Unit: 807 tests (API 237, web 202, workers 92, ai-engine 91, contracts 74, shared 74, ui 32, storage 5).
- Integration against PostgreSQL and Redis: API 420 tests in 33 suites, workers 73 tests in 5 suites.
- Browser (Playwright, Chrome): 19 tests in 9 spec files. These run locally only; they are not part of CI.
- Infrastructure: 37 CDK assertions; `cdk synth` with cdk-nag for dev, staging and prod.

## 3. Implemented but never tested against the real service

Each of these has code and tests with fakes or a mock, and has **never** made a real call.

| Item                                    | What is unverified                                                                                                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic, OpenAI, Amazon Bedrock       | Any real request: streaming, tool calling, usage numbers, error mapping, model ids. Since the zod 4 upgrade the tool and structured-output JSON Schemas are generated differently and were checked only against the mock provider. |
| Email delivery (SMTP)                   | No email was ever sent. The AWS stack sets `EMAIL_DRIVER=log`.                                                                                                                                                                     |
| AWS deployment                          | The CDK stacks were synthesized, never deployed. Nothing was run on ECS, RDS (including pgvector on RDS), ElastiCache, S3 or behind the load balancer.                                                                             |
| Docker images on a real host            | Built and started in GitHub Actions only (health checks, registration, organization creation). Never run on ECS or with production secrets.                                                                                        |
| S3 storage driver                       | Unit tests with a fake client only.                                                                                                                                                                                                |
| n8n                                     | Tested against a local HTTP server, not an n8n instance.                                                                                                                                                                           |
| GitHub OIDC deploy workflow             | `deploy-aws.yml` is disabled and was never run.                                                                                                                                                                                    |
| Backup, restore, runbooks, alarms, SLOs | Documented, never exercised.                                                                                                                                                                                                       |

## 4. Partial

| Item                    | State                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hebrew                  | UI and emails are translated; the Hebrew text is an unreviewed draft. Notification titles and bodies and some API conflict or limit messages remain English. |
| Kanban on touch screens | Drag and drop is untested on touch; a "Move to…" menu does the same.                                                                                         |
| Currencies              | Totals are summed in the organization's reporting currency; other currencies are listed separately. There is no exchange-rate conversion.                    |
| Content-Security-Policy | Sent on every page, but still allows inline scripts and styles.                                                                                              |
| Worker budget check     | Uses recorded usage without a reservation; jobs starting at the same instant can overshoot by their own consumption.                                         |
| Agent evaluation        | Deterministic checks only (contains, does not contain, equals, regex). No model-graded scoring and no side-by-side comparison of two runs.                   |
| Agent teams             | An agent can delegate to selected agents; there is no team entity or orchestration view.                                                                     |
| Workflow editor         | Form-based with step reordering; no drag-and-drop canvas.                                                                                                    |
| Plan limits             | The `agents` and `automations` plan limits are displayed but not enforced at creation (gap analysis A6).                                                     |
| Rate limiting           | Per-IP limiter state is in memory per API instance, not shared between instances.                                                                            |
| Domain events           | Changes made by AI tools and workflow steps do not emit domain events (so they do not trigger other workflows).                                              |

## 5. Not implemented

Customer-facing channels (web chat widget, inbound email, WhatsApp), AI auto-reply to customers, payments and invoices
(`POST /billing/checkout` answers 501), MFA and SSO, a platform operator console, long-term agent memory, guardrails /
content moderation, OCR and DOCX/XLSX ingestion, external CRM sync, the AgentCore runtime (design document only), an
email-sending workflow step, lead enrichment.

## 6. Blocked on something outside the repository

| Needed                                             | For                                                       |
| -------------------------------------------------- | --------------------------------------------------------- |
| An AWS account, a region with Bedrock model access | First deployment and any Bedrock call                     |
| API keys for Anthropic and/or OpenAI               | Live provider verification                                |
| SMTP or SES credentials and a sender domain        | Real email, and turning on `REQUIRE_EMAIL_VERIFICATION`   |
| A domain name and an ACM certificate               | HTTPS in front of the load balancer                       |
| A payment provider account                         | Checkout, invoices, plan changes                          |
| A Meta Cloud API or Twilio account                 | WhatsApp                                                  |
| A native Hebrew reviewer                           | Sign-off on the Hebrew copy                               |
| The owner's decision on rewriting git history      | Removing `dump.rdb` (a local Redis dump) from old commits |

## 7. Changes in the last working session (2026-11-12)

- GitHub Actions had never run (account billing lock). Once unlocked, the first real run exposed and led to fixes for:
  unformatted files, seed before package build, four high-severity dependency advisories, tests that assumed IPv4 `localhost`,
  and Docker images that did not build.
- zod upgraded from 3 to 4. A real regression was caught by the integration tests (PATCH requests silently wrote create-time
  defaults) and fixed with `partialUpdate()` plus a regression test.
- Two defects that would have broken the first AWS deployment were found and fixed: the migrate task pointed at files the API
  image did not contain, and nothing seeded the permission catalog. CI now applies the migrations from the built image and
  starts the containers.
- Added: email-verification enforcement and resend, per-account login lockout, Content-Security-Policy, worker-side budget
  check, Hebrew emails, agent evaluation datasets.

## 8. Known risks to weigh before a pilot

1. No real model call has ever been made; expect adjustments on first contact with a real provider.
2. The first AWS deployment is the first time the infrastructure code runs for real.
3. `AI_BEDROCK_ENABLED` bills every tenant's usage to the deploying AWS account; there is no customer billing yet.
4. Emails are not delivered until SMTP/SES is connected; password reset and invitations depend on it.
5. The browser tests are not in CI, so a UI regression can pass CI.
6. **Intermittent browser-test failure, cause unknown.** On 2026-11-12, 5 of 12 full local Playwright runs had one failing test: a sidebar link click that did not change the page in time (four times in the knowledge journey, once in the AI journey; in one case the page had not changed after 30 seconds). All five happened within about 15 minutes; the 7 other runs passed 19/19, including the last 6 in a row on the same build, and the failing test passed when re-run alone. It was not reproduced on demand and was not diagnosed: it may have been load in the test sandbox, or a real client-navigation stall. Worth watching during manual testing: if a menu click appears to do nothing, note the page and the time.
7. `dump.rdb` remains in git history of a private repository.
