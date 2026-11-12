# Functional Specification

As-built specification (2026-11-10). Each section states the behaviour the code implements, with the rules and limits it
enforces. Items marked **[not built]** are listed so readers do not assume them. Endpoint detail and status codes:
[docs/api/api-overview.md](../api/api-overview.md); screens: [screen-specifications.md](../design/screen-specifications.md);
status per feature: [feature-matrix.md](./feature-matrix.md).

## 1. Cross-cutting rules

- **API**: REST under `/api/v1`, JSON, success `{ data, meta? }`, error `{ error: { code, message, details?, requestId } }`,
  pagination `page`/`pageSize` → `meta { page, pageSize, total, totalPages }`, Swagger at `/api/docs` (off in production unless
  `SWAGGER_ENABLED=true`).
- **Tenancy**: bearer token (user-scoped, 15 min) + `x-organization-id` validated against an _active_ membership of a non-deleted
  organization. Foreign resources answer `404`, references to foreign ids in a body answer `400`.
- **Authorization**: 38 permission keys (`resource:action`); organization roles hold sets of keys. System roles: `owner` (all, immutable),
  `admin` (all except `organization:delete`), `member` (read/create/update on CRM, assistant use, agent read/execute, knowledge/
  automation/integration/analytics read, notifications; **no** assign, delete, manage, audit, billing).
- **Audit**: authentication events, permission denials, tenant-violation attempts, organization/member/role changes, CRM and AI
  operations, document access, workflow/agent changes are written to `AuditLog` with actor, IP, user agent, request id.
- **Limits and throttling**: global per-IP rate limit (`RATE_LIMIT_MAX` per `RATE_LIMIT_TTL_SECONDS`), stricter on auth routes
  (`AUTH_RATE_LIMIT_MAX`), per-IP on inbound webhooks; body limit `BODY_LIMIT` (1 MB), request timeout `REQUEST_TIMEOUT_MS`.
- **Plan limits** (`PLAN_LIMITS`): free = 2 seats, 100k AI tokens/month, 1 agent, 10 documents, 100 MB, 2 automations; starter = 5 / 1M / 5 / 100 /
  1 GB / 10; pro = 25 / 10M / 25 / 1 000 / 10 GB / 100; enterprise = 1 000 / 1B / 1 000 / 100 000 / 1 TB / 10 000. No prices are configured.
  Enforced: seats, AI tokens, documents, storage. Not enforced: agents, automations.
- **Localization**: English only. Organization and user records carry a `locale`; it has no effect on the UI.

## 2. Identity and access

| Capability         | Behaviour and rules                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register           | Email (lower-cased, unique) + password (≥ 10 chars, upper, lower, digit; ≤ 128). Optional `invitationToken` joins that organization. Sets refresh cookie, enqueues `verify_email` (token TTL 24 h)                                                                                                                                                                    |
| Login              | Same `INVALID_CREDENTIALS` for unknown email and wrong password. Argon2id verification. Audited success and failure. After `LOGIN_MAX_FAILED_ATTEMPTS` (10) failures for one email within `LOGIN_LOCKOUT_WINDOW` (15 min) further logins for that email answer `429` until the window ends                                                                            |
| Tokens             | Access JWT 15 min (memory only in the browser). Refresh: opaque, `httpOnly; Lax`, path `/api/v1/auth`, 30 days, SHA-256 at rest, rotated on use; reuse of a rotated token revokes the whole family and is audited                                                                                                                                                     |
| Password reset     | `forgot-password` always returns 202; token TTL 1 h, single use; reset revokes all sessions                                                                                                                                                                                                                                                                           |
| Change password    | Requires current password; revokes other sessions                                                                                                                                                                                                                                                                                                                     |
| Email verification | Single-use token; sets `emailVerifiedAt`. `POST /auth/resend-verification` (signed in, one email per `EMAIL_VERIFICATION_RESEND_COOLDOWN`). With `REQUIRE_EMAIL_VERIFICATION=true` an unverified account can only reach the session, profile and verification routes; everything else answers `403 EMAIL_NOT_VERIFIED` (off by default: it needs real email delivery) |
| Sessions           | List own sessions (user agent, IP, last active) and revoke one                                                                                                                                                                                                                                                                                                        |
| MFA, SSO, API keys | **[not built]**                                                                                                                                                                                                                                                                                                                                                       |

## 3. Organizations, members, roles, invitations

- Create organization: one transaction creates the three system roles, the owner membership and a `free` subscription. Slug is
  generated from the name; collision appends a random suffix.
- Settings (`organizationSettingsSchema`, strict): business hours (per weekday open/close or closed), branding primary colour, AI defaults
  (default provider `anthropic|openai`, model, assistant name, tone `professional|friendly|concise`, standing instructions ≤ 4 000 chars),
  reporting currency. **Only the AI fields affect behaviour; business hours and branding colour are stored and displayed only.**
- Delete organization: owner only, soft delete; the tenant guard then rejects every member.
- Members: list, change role/status (owner-role changes require an owner; the last owner cannot be demoted, suspended or removed; no self
  status change), remove, leave. A suspended member is treated as a non-member on the next request.
- Roles: custom roles with any subset of permission keys; system roles cannot be renamed or deleted; owner permissions cannot be reduced;
  a role with members or pending invitations cannot be deleted.
- Invitations: `members:invite`; hashed token, TTL 7 days (lazy `expired` status), unique pending per email, owner invitations require an owner,
  seat limit checked (`402 ENTITLEMENT_EXCEEDED`), email via the `invitation` template. Accepting requires a signed-in account with the
  invited email; the inviter is notified.

## 4. CRM

### Contacts

Fields: first/last name, email (lower-cased), phone, company, job title, tags[], notes, owner, `customFields` (JSON, API only).
Search (case-insensitive over name, email, company, phone), tag and owner filters, sort; soft delete; `GET /contacts/tags`.
Owner must be an active member. **[not built]** import/export, merge/de-duplication.

### Leads

Fields: title, description, status, source (website, referral, social, email, phone, whatsapp, event, ai_assistant, import, other), value + currency
(default USD), expected close date, contact, assignee, tags, `customFields` (API only), lost reason (≤ 500 chars), `convertedAt`.

- Status set: `new → contacted → qualified → proposal → won | lost`. Any status may be set from any other; the UI stepper offers the sequence and asks for a lost reason.
- Every meaningful change writes a typed activity (`created`, `status_changed {from,to,lostReason?}`, `assigned`, `value_changed`, `contact_linked`, `note_added`,
  `converted`, `updated {fields}`). No change → no activity.
- Assigning to someone else needs `leads:assign` (self-assignment allowed); the assignee gets an in-app notification.
- Conversion happens once: links an existing contact or creates one (exactly one of `contactId` / `contact`), sets `convertedAt`, optionally marks the lead `won`.
- Notes: `leads:update` to add; delete by author or holder of `leads:delete`.
- Soft delete (`leads:delete`). **[not built]** deals, pipelines, Kanban board, lead scoring, tasks.
- Known limits: PATCH cannot clear `value` or `contactId` to null (and a contact's `ownerId`); won/lost periods use `updatedAt` (no `closedAt`).

### Conversations and messages

Channel label (web, email, whatsapp, phone, internal, api), status `open | pending | resolved | archived`, subject, contact, lead, assignee.

- Messages roles accepted from the API: `agent` (authored by the caller), `customer`, `system`. `assistant` is rejected.
- Archived conversations are read-only (409). A new message re-opens a `resolved` conversation.
- Assignment needs `conversations:assign`; creating with an initial message stores it as an agent message.
- **[not built]** channel connectors, inbound email/WhatsApp, AI auto-reply, SLA timers, canned replies.

### Companies, deals, pipelines, tasks, import/export

Added 2026-11-11; the behaviour is specified by the contracts in `packages/contracts/src/{deals,tasks,import-export}.ts` and
verified by `deals.int-spec`, `tasks.int-spec`, `data-exchange.int-spec` and `security/sales-cross-tenant.int-spec`. In short:
companies with linked contacts; pipelines with ordered stages (probability, won/lost flags) and one default; deals that move
between stages with a recorded history and a required reason when lost; a board endpoint with per-stage, per-currency totals and
a conversion report; tasks with priority, due date, reminder (sent by the workers), assignee and links to a lead, contact, deal
or conversation; CSV import with column mapping, dry run, duplicate handling and background execution; CSV export honouring the
list filters.

### Notifications

Types: `member_joined`, `invitation_received`, `lead_assigned`, `conversation_assigned`, `agent_execution_completed`, `agent_execution_failed`, `document_processed`, `document_failed`, `automation_failed`, `system` (budget alerts are delivered as notifications to billing managers).
In-app on by default per type; email only if the user opted in for that type. Preferences are per user (stored in `User.preferences`). Mark read / read all.

## 5. AI

### Providers and configuration

Per-organization `AiProviderConfig` (kinds `anthropic`, `openai`, `bedrock`, `mock`). API keys are encrypted (AES-256-GCM, organization-bound) and never returned
(`hasApiKey`, `keyLast4`). `mock` only when `AI_ALLOW_MOCK_PROVIDER=true` and never in production. `bedrock` needs `AI_BEDROCK_ENABLED=true` and an
AWS identity on the server; no key. Health check stores the last result. A provider referenced by agents cannot be deleted (409).
Cost estimates exist only for models priced in `AI_PRICING_JSON`; otherwise cost is `null` and shown as "No pricing configured".

### Assistant

Threads are private to their owner. Messages stream over SSE. The assistant's system prompt is built from organization settings (name, tone, standing
instructions) and optional context (`leadId`, `contactId`, `conversationId`). Tools available to it are limited by the caller's permissions. Older turns
are folded into a rolling summary (worker) when the context window is exceeded. Admission: plan token limit (402) and monthly budget hard stop (402 `BUDGET_EXCEEDED`).

### Agents

Definition: name, instructions, provider/model, temperature, output cap, allowed tools, knowledge bases, limits `maxSteps` (1–50, default 12),
`maxDurationMs` (1 s–15 min, default 2 min), `maxTokens` (1k–2M, default 150k), `maxDelegations` (0–10, default 3), retry policy, enabled flag.

- Execution: `sync` (inline, short cap, 200) or `async` (queued, 202, worker). Statuses queued, running, succeeded, failed, cancelled. Cancel is cooperative.
- Steps are persisted (model call, tool call, delegation) with tokens and cost.
- Delegation (`agents.delegate`, `agents.delegate_parallel`) shares one budget across the tree; depth bounded by `maxDelegations`.
- Triggers recorded: manual, api, automation (workflow `agent_run`), agent (delegated), schedule.
- Tools (12): `crm.search_contacts`, `crm.get_contact`, `crm.create_contact`, `crm.search_leads`, `crm.get_lead`, `crm.create_lead`, `crm.update_lead_status`,
  `crm.add_lead_note`, `crm.list_conversations`, `crm.get_conversation_messages`, `time.now`, `knowledge.search`. Check order: tool exists → in the agent's allow-list →
  caller holds the required permission → write/dangerous policy. Retrieved content and tool output are wrapped as data, not instructions.
- Async runs act with the _triggering user's current_ permissions; automation/schedule runs have no user and only the agent's allow-list.
- **[not built]** agent teams definition/UI, long-term memory, evaluation datasets, guardrail service.

### Evaluations

A dataset holds up to 50 cases; a case is an input plus 1–10 checks (`contains`, `not_contains`, `equals`, `regex`; text checks
ignore case and repeated whitespace). A run executes one agent against every case in the workers (one agent execution per case,
sequentially), stores the answer and each check's result, and reports passed / failed / errored and a pass rate. A case passes
only when every check passes; an agent execution that does not succeed is an error, not a failed check. Runs can be cancelled, are
resumable after a worker restart, obey the AI budget hard stop, and one dataset+agent pair can have only one active run.
Scoring is deterministic only; there is no model-graded evaluation.

### Prompt templates

`{{variable}}` placeholders extracted automatically, version increments on content change, system templates cannot be deleted, render endpoint reports missing variables.

## 6. Knowledge base

- Bases hold documents; each document has a status `uploaded → processing → ready | failed` and a failure message.
- Upload: extensions `.txt .md .markdown .csv .html .htm .json .pdf` (MIME allow-list and extension map), size ≤ `MAX_UPLOAD_MB` (default 25), plan limits on document count and
  storage (`402`). Stored under `org/<orgId>/documents/…`; the key is never exposed.
- Processing (worker): extract (PDF text via `pdf-parse`; scanned PDFs fail with a clear error), chunk (~400 tokens, 60 overlap), embed with the organization's embedding-capable
  provider (vectors normalised to 1536 dims), store in pgvector, emit `document.processed` / `document.failed`.
- Search: cosine similarity, organization-scoped, optional base filter and `minScore`; returns document title, chunk index, score. Used by `/knowledge/search`, the Retrieval-test tab and the `knowledge.search` tool.
- Reprocess, download (audited, tenant-checked), chunk viewer, delete (removes chunks and object). **[not built]** OCR, checksum de-duplication, DOCX/XLSX/image ingestion.

## 7. Automation

- Workflow = trigger + ordered steps (≤ 30), stored as data, validated before enabling (references to agents, integrations, endpoints must belong to the organization).
- Triggers: `manual`; `event` (lead.created, lead.status_changed, lead.assigned, lead.converted, contact.created, conversation.created, conversation.message_received,
  conversation.assigned, conversation.resolved, document.processed, document.failed, agent.execution_completed, agent.execution_failed, member.joined); `schedule` (5-field cron, evaluated in the organization time zone, checked every minute); `webhook` (inbound endpoint).
- Steps: `agent_run`, `send_notification` (user / assignee / role), `http_request` (SSRF-guarded, ≤ 60 s), `update_lead`, `create_lead_note`, `delay`, `condition`
  (`eq neq contains gt lt exists`), `n8n_trigger`, `outbound_webhook`, `set_variable`. Templates `{{ path }}` read from `{ trigger, input, steps }` only. Run limit 15 min.
- Execution records each step result; failure marks the run failed with the step id. Delays persist and resume through a delayed job.
- Inbound webhooks: `POST /api/v1/hooks/:organizationSlug/:endpointSlug`, auth by `x-hilatech-signature: sha256=<hmac>` or `x-webhook-secret`, 202 with `executionId`, secret shown once at creation/rotation.
- Outbound webhooks: subscribe to domain events; HMAC-SHA256 over `timestamp.body`; 5 attempts with exponential backoff; delivery log; https only (http for localhost); private ranges refused.
- **[not built]** drag-and-drop canvas, email/WhatsApp/task/deal steps, per-tenant execution quotas (plan `automations` is not enforced).

## 8. Integrations

Catalogue: `rest` and `n8n` (live: connectivity test, `http_request`/`n8n_trigger` steps); `email`, `whatsapp`, `crm` (configuration stored with encrypted secrets, **nothing is sent or synced**,
test cannot pass). Secrets are write-only and organization-bound.
System email (invitations, password reset, verification, digests) is separate: `EMAIL_DRIVER=log` (default, prints with tokens masked) or `smtp` (nodemailer, never exercised).

## 9. Analytics and reporting

- Dashboard (`period` 7d/30d/90d, whole UTC days, zero-filled series): counts and series for leads, contacts, conversations; lead funnel; recents; pipeline value (sums across currencies).
- Reports (`analytics:read`, range or granularity): business, sales (derived from leads), agents (executions, success, tokens, cost where priced), automation (runs, failures), usage (against plan, current month).
  CSV export for business and usage. All figures are computed live from operational tables; the analytics worker does not persist roll-ups.

## 10. Billing readiness

- `Subscription` with plan, status, period, provider fields; new organizations are on `free`. Plan catalogue and upgrade options are data only.
- Entitlements overview combines plan limits and current usage with `ok | warning | exceeded` states.
- AI budget per organization: monthly token and/or USD cost budget, hard stop (off by default), warning threshold (default 80 %), alert kinds `warning` and `exceeded`; admission control runs before provider calls in the API (sync reservation
  in Redis); alerts create `BudgetAlert` rows and notifications to billing managers. Workers do not re-check.
- `POST /billing/checkout` returns `501 PAYMENT_NOT_CONFIGURED`. **[not built]** payment provider, invoices, trials, plan change by customer.

## 11. Non-functional requirements as built

| Area          | Implementation                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security      | Helmet, strict CORS (`CORS_ORIGINS`), Argon2id, hashed tokens, AES-256-GCM secrets, SSRF guard, log redaction, no secrets in responses (tested)                                        |
| Reliability   | BullMQ with idempotent job ids, exponential backoff, retained failed jobs; workers drain on SIGTERM; health endpoints on API (`/health`, `/health/ready`) and workers (`:4100/health`) |
| Observability | pino JSON logs with `x-request-id`, queue metrics logs. No metrics endpoint, tracing or dashboards in the application (AWS CloudWatch is defined in CDK, not deployed)                 |
| Performance   | Report queries checked with EXPLAIN on ~800k seeded rows (uses org/date indexes). No load test result is part of this document                                                         |
| Accessibility | Radix primitives, skip link, focus ring, reduced-motion support. No automated audit                                                                                                    |
