# Tenant Isolation

Model: **shared database, shared schema, application-enforced isolation**. Every organization-owned row carries
`organizationId`; the code is responsible for filtering on it. There is no Postgres row-level security, no
schema-per-tenant and no per-tenant queue (see "Known limits"). This document describes what the code does today and
which tests prove it. Decision record: ADR-004 in [decisions.md](./decisions.md).

## 1. Establishing the tenant (API)

| Step                 | Code                                             | Behaviour                                                                                                                                                           |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticate         | `modules/auth/jwt-auth.guard.ts` (global)        | Access token is **user-scoped** (no organization claim). A valid token for a deactivated/deleted user is rejected                                                   |
| Select organization  | `modules/tenancy/organization.guard.ts` (global) | Reads `x-organization-id` as a _selector only_; must be a UUID, else `400 ORGANIZATION_REQUIRED`                                                                    |
| Authorize membership | `tenancy.service.ts#resolveTenant`               | One query: membership for `(userId, organizationId)` with `status = active`, `organization.deletedAt = null`, `user.isActive = true`. No row → `403 NOT_A_MEMBER`   |
| Audit the attempt    | `AuditService`                                   | A failed selection writes `security.tenant_violation_attempt` (attacker as actor, attempted org id in metadata; **not** written into the victim organization's log) |
| Attach context       | `request.tenant = TenantContext`                 | `{ organizationId, userId, memberId, roleId, roleKey, permissions }`, loaded fresh on every request (role changes and suspensions apply immediately)                |
| Check permission     | `permissions.guard.ts` + `@RequirePermissions`   | All listed keys required. Denials write `security.permission_denied` with the missing keys                                                                          |
| Opt-outs             | `@Public()`, `@NoTenant()`                       | Used only by auth, health, org list/create, invitation preview/accept, user preferences, plan catalogue and the inbound webhook route                               |

Guard order is fixed in `app.module.ts`: throttler → `JwtAuthGuard` → `OrganizationGuard` → `PermissionsGuard`.

## 2. Services and queries

- Controllers never read `organizationId` from a body, query or path. Services receive `TenantContext` and put
  `organizationId: tenant.organizationId` into every Prisma `where`/`data`.
- Resources addressed by id are always looked up as `{ id, organizationId }`. A foreign id therefore returns
  **`404 NOT_FOUND`**, never `403`, so existence does not leak.
- Ids **referenced inside a payload** (`contactId`, `leadId`, `assigneeId`, `ownerId`, `knowledgeBaseIds`, `workflowId`,
  `providerConfigId`…) are validated to belong to the same organization; otherwise `400 VALIDATION_ERROR` with the
  offending field path. Workflows that reference foreign resources cannot be enabled.
- Private-to-user data inside a tenant: assistant threads (`userId` filter), notifications (caller's rows where
  `organizationId` = selected org **or** `null`).
- Secrets are bound to the tenant cryptographically: `SecretBox` encrypts AES-256-GCM with the organization id as
  additional authenticated data, so ciphertext copied to another organization does not decrypt.

## 3. Raw SQL

Raw SQL exists in a small, enumerated set of places; every statement filters `"organizationId"`:

| File                                                                                  | Purpose                                                                                                     |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/ai-engine/src/knowledge/pgvector-store.ts`                                  | chunk embedding write, similarity search (`WHERE c."organizationId" = …`), embedded count                   |
| `apps/api/src/modules/analytics/analytics.service.ts`, `analytics-reports.service.ts` | time-series and aggregate reports                                                                           |
| `apps/api/src/modules/contacts/contacts.service.ts`                                   | distinct tags (`unnest`)                                                                                    |
| `apps/workers/src/automation/automation.processor.ts`                                 | `runCount`/`lastRunAt` update — keyed by workflow id that was already loaded under `{ id, organizationId }` |

When adding raw SQL, filter on `organizationId` in the statement itself and add a case to the matching cross-tenant suite.

## 4. Workers

- Every job payload (`packages/contracts/src/queues.ts`) carries `organizationId` (nullable only for user-scoped
  notifications) and an `idempotencyKey`. Workers re-validate payloads with the zod schema; invalid → `UnrecoverableError`.
- Processors re-load the target as `{ id, organizationId }`. A job whose id belongs to another organization is
  **skipped** (`not_found` / mismatch), never processed — tested for documents, agent executions, conversation
  summaries, workflow executions and webhook deliveries.
- Agent runs executed by a worker resolve the triggering user's permissions from their **active membership** at run time
  (`apps/workers/src/ai/user-permissions.ts`, mirror of `resolveTenant`). No active membership → every permission-gated
  tool is denied. Automation/schedule-triggered runs have `userId = null` and only reach tools allowed by the agent's
  own allow-list.
- Tool calls receive a `ToolContext` with `organizationId`; every built-in tool scopes its queries by it and the
  `ToolExecutor` checks allow-list → required permission → write policy and audits each call.
- Workflow templates (`{{ path }}`) resolve only against `{ trigger, input, steps }`; they cannot reach prototypes or
  other tenants (`workflow-runner.spec.ts`).

## 5. Vector search

- `DocumentChunk.embedding` is one `vector(1536)` column with a single HNSW index shared by all tenants (ADR-013).
  Isolation is the `WHERE "organizationId" = …` predicate on every statement, not a separate index.
- Knowledge bases named in a search or in an agent's `knowledgeBaseIds` are resolved through the organization first; a
  foreign id gives `404` from the API.
- Identical content in two tenants never crosses: tested at API level and at worker level.

## 6. Webhooks

- **Inbound** `POST /api/v1/hooks/:organizationSlug/:endpointSlug` is the only unauthenticated tenant entry point. It
  resolves the organization by slug (non-deleted), then the endpoint by `(organizationId, slug)`. The secret is stored as a
  SHA-256 hash, compared in constant time, and unique per endpoint; unknown org, unknown endpoint and bad secret
  return the same failure. Executions are created in the endpoint's organization only. Rate limit: per IP,
  `WEBHOOK_RATE_LIMIT_MAX`.
- **Outbound** subscriptions, deliveries and signing secrets are per organization. Fan-out of a domain event only
  considers enabled subscriptions of the emitting organization. Requests go through the SSRF guard
  (`packages/shared/src/automation/ssrf.ts`): https only (http for localhost), private/loopback ranges refused,
  re-checked before each attempt.

## 7. Storage keys

- Keys are built as `org/<organizationId>/<category>/<yyyy>/<mm>/<uuid><ext>` (`packages/storage/src/index.ts`);
  `assertValidKey` rejects traversal (`..`).
- The storage driver itself does **not** enforce the prefix. Isolation relies on the API: `storageKey` is never
  returned to clients, and downloads load the `Document` as `{ id, organizationId }` first, then stream its key, then audit
  `document.downloaded`.
- When a knowledge base is deleted the API deletes the objects of that base's documents.

## 8. Cross-tenant test suites

Run with `pnpm --filter @hilatech/api test:integration` (all 26 suites / 337 tests passed on 2026-11-10; the first of two
back-to-back runs that day reported 10 suites failing to complete with no individual test failure, the second was fully
green — suspected contention on the shared test database, not investigated).

| Suite                                                               | What it proves                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/test/security/cross-tenant.int-spec.ts`                   | Forged writes against org B rejected and unchanged; every attempt audited with the attempted org id; org B ids are 404 from org A; invitation revoke across tenants impossible; audit/member lists contain only own rows; `/auth/me` with a forged header yields no active organization |
| `apps/api/test/security/crm-cross-tenant.int-spec.ts`               | Contacts/leads/conversations: read, update, delete, assign and sub-resources are 404 across tenants; foreign ids in payloads are validation errors; lists/search never include foreign rows; dashboard unaffected by other tenants; member role cannot assign or delete                 |
| `apps/api/test/security/ai-cross-tenant.int-spec.ts`                | Provider configs, prompts, agents, executions: 404; assistant threads private to owner; lists never leak; foreign references in payloads rejected; member role cannot manage AI config                                                                                                  |
| `apps/api/test/security/knowledge-cross-tenant.int-spec.ts`         | Files under owning org prefix; 404 for bases/documents/chunks/files; search from org B returns only org B chunks even with identical content; foreign knowledge base ids refused; vector store and `knowledge.search` tool are org-scoped                                               |
| `apps/api/test/security/automation-cross-tenant.int-spec.ts`        | Forged header on every automation route; workflows, executions, webhooks, deliveries, inbound endpoints and integrations 404; per-org inbound credentials; no secret material in any response; ciphertext bound to its org (AAD)                                                        |
| `apps/api/test/security/analytics-billing-cross-tenant.int-spec.ts` | Org B sees none of org A's analytics; budgets, alerts, entitlements per org; budget-alert notifications reach only the org's billing managers                                                                                                                                           |
| `apps/api/test/security/permissions.int-spec.ts`                    | Member-role grants and denials; denials audited; suspended member treated as non-member                                                                                                                                                                                                 |
| `apps/api/test/security/tokens.int-spec.ts`                         | Token validation, refresh reuse revokes family, user-scoped tokens cannot select a foreign org                                                                                                                                                                                          |
| `apps/api/test/security/leaks.int-spec.ts`                          | No password hashes, tokens, secrets or stack traces in responses; security headers                                                                                                                                                                                                      |
| `apps/workers/test/document-processing.int-spec.ts`                 | Organization mismatch is a no-op; org B never retrieves org A chunks                                                                                                                                                                                                                    |
| `apps/workers/test/automation.int-spec.ts`                          | Foreign lead id fails the step and leaves the lead untouched; wrong-organization execute and delivery jobs are skipped; event fan-out stays within the org                                                                                                                              |
| `apps/workers/test/ai-tasks.int-spec.ts`                            | Execution not in the organization is skipped; conversation of another organization is skipped                                                                                                                                                                                           |

Guard unit tests: `apps/api/src/modules/tenancy/guards.spec.ts`.

## 9. Known limits

1. **No database-level backstop.** A missing `organizationId` filter in new code is a data leak; Postgres RLS is not
   enabled. The cross-tenant suites are the safety net — every new endpoint needs a case.
2. **Shared resources, no fairness.** One HNSW index, one set of BullMQ queues (prefix `BULLMQ_PREFIX`) and one Redis for all
   tenants; there are no per-tenant concurrency or rate quotas. Rate limiting is per IP, not per organization, and uses
   the default in-memory throttler store (not shared across API replicas).
3. **Budget re-check gap.** Monthly AI budget admission is enforced in the API before provider calls; queued agent
   runs, workflow `agent_run` steps and embedding jobs are not re-checked in workers, so a tenant can overshoot its hard stop.
4. **Plan limits `agents` and `automations` are not enforced** at creation (reported only).
5. **Storage driver is tenant-agnostic**; the prefix convention plus DB lookup is the control. A bug that passes a foreign
   key to the driver would not be stopped by the driver.
6. **Organization header** is a selector; it is safe only because `OrganizationGuard` validates it. New global guards or
   `@NoTenant()` routes must not read it directly.
7. **Slug enumeration on inbound webhooks:** organization and endpoint slugs are part of the public URL; secrecy rests on
   the endpoint secret, not the slug.
8. **No operator/super-admin plane**, so cross-tenant support access does not exist (and is not audited because it
   cannot happen).
9. **Web client** keeps the access token in memory and the active organization id in the session store; it is a UX
   convenience, not a control (the API re-validates every request).
