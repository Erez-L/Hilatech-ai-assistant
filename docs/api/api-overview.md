# API Overview

Base URL: `/api/v1`. Interactive documentation: `/api/docs` (Swagger UI) when the API runs in
non-production mode (or when `SWAGGER_ENABLED=true`).

## Conventions

- JSON everywhere. Success: `{ "data": …, "meta"?: … }`. Errors:
  `{ "error": { "code", "message", "details"?, "requestId"? } }`.
- Authentication: `Authorization: Bearer <accessToken>`.
- Organization selection: `x-organization-id: <uuid>` (validated against membership).
- Pagination: `?page=1&pageSize=20` → `meta: { page, pageSize, total, totalPages }`.
- Sorting/filtering/search parameters are defined per resource in `@hilatech/contracts`.
- Error codes are enumerated in `@hilatech/contracts` (`ErrorCode`).

## Resource map (status is maintained in docs/development/task-status.md)

| Area          | Endpoints                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health        | `GET /health`, `GET /health/ready`                                                                                                                                                                                                                                          |
| Auth          | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email`, `POST /auth/change-password`, `GET /auth/sessions`, `DELETE /auth/sessions/:id` |
| Organizations | `GET/POST /organizations`, `GET/PATCH/DELETE /organizations/current`, `GET/PUT /organizations/current/settings`                                                                                                                                                             |
| Members       | `GET /members`, `PATCH /members/:id`, `DELETE /members/:id`                                                                                                                                                                                                                 |
| Roles         | `GET/POST /roles`, `GET/PATCH/DELETE /roles/:id`, `GET /permissions`                                                                                                                                                                                                        |
| Invitations   | `GET/POST /invitations`, `DELETE /invitations/:id`, `GET /invitations/preview?token=`, `POST /invitations/accept`                                                                                                                                                           |
| Users         | `GET/PATCH /users/me`, `PUT /users/me/preferences`                                                                                                                                                                                                                          |
| Audit         | `GET /audit-logs`                                                                                                                                                                                                                                                           |
| Contacts      | `GET/POST /contacts`, `GET /contacts/tags`, `GET/PATCH/DELETE /contacts/:id`                                                                                                                                                                                                |
| Leads         | `GET/POST /leads`, `GET/PATCH/DELETE /leads/:id`, `POST /leads/:id/assign`, `POST /leads/:id/convert`, `GET/POST /leads/:id/notes`, `DELETE /leads/:id/notes/:noteId`, `GET /leads/:id/activities`                                                                          |
| Conversations | `GET/POST /conversations`, `GET/PATCH /conversations/:id`, `POST /conversations/:id/assign`, `GET/POST /conversations/:id/messages`                                                                                                                                         |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET/PUT /notifications/preferences`                                                                                                               |
| Analytics     | `GET /analytics/dashboard?period=7d\|30d\|90d`                                                                                                                                                                                                                              |
| Billing       | `GET /billing/subscription`, `GET /billing/usage`, `GET /billing/plans`                                                                                                                                                                                                     |

## Implemented in `apps/api` (Priority 1, 2026-11-09)

Guards: `JwtAuthGuard` (global; `@Public()` skips) → `OrganizationGuard` (global; `@NoTenant()` skips) →
`PermissionsGuard` (`@RequirePermissions`). Rate limiting is global; `@AuthThrottle()` applies
`AUTH_RATE_LIMIT_MAX`. All bodies/queries are validated with the zod contracts; Swagger is generated from
the same schemas (`src/common/openapi/zod-openapi.ts`).

| Method & path                                            | Auth                     | Tenant header | Permission / rule                  | Notes                                                                                                       |
| -------------------------------------------------------- | ------------------------ | ------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /health`, `GET /health/ready`                       | public                   | –             | –                                  | terminus body shape, not enveloped                                                                          |
| `POST /auth/register`                                    | public, auth throttle    | –             | –                                  | 201; optional `invitationToken` joins that org; sets refresh cookie; queues `verify_email`                  |
| `POST /auth/login`                                       | public, auth throttle    | –             | –                                  | 401 `INVALID_CREDENTIALS` for unknown email and wrong password alike                                        |
| `POST /auth/refresh`                                     | cookie `hta_refresh`     | –             | –                                  | rotates; reuse → 401 `TOKEN_REUSED` + family revoked; revoked → `TOKEN_INVALID`                             |
| `POST /auth/logout`                                      | cookie (optional bearer) | –             | –                                  | 204; revokes the family, clears cookie                                                                      |
| `GET /auth/me`                                           | bearer                   | optional      | –                                  | `Session`; invalid/non-member header → `activeOrganization: null`                                           |
| `POST /auth/forgot-password`                             | public, auth throttle    | –             | –                                  | always 202 `{ accepted, message }`                                                                          |
| `POST /auth/reset-password`                              | public, auth throttle    | –             | –                                  | 204; revokes all sessions                                                                                   |
| `POST /auth/verify-email`                                | public, auth throttle    | –             | –                                  | 204; single use                                                                                             |
| `POST /auth/change-password`                             | bearer                   | –             | –                                  | 204; revokes other sessions                                                                                 |
| `GET /auth/sessions`                                     | bearer                   | –             | –                                  | `AuthSession[]` (familyId, createdAt, lastActiveAt, expiresAt, userAgent, ipAddress, current)               |
| `DELETE /auth/sessions/:familyId`                        | bearer                   | –             | own sessions only                  | 204                                                                                                         |
| `GET /users/me`, `PATCH /users/me`                       | bearer                   | –             | –                                  | `AuthUser`; patch: firstName, lastName, avatarUrl                                                           |
| `GET /users/me/preferences`, `PUT /users/me/preferences` | bearer                   | –             | –                                  | `{ theme, locale, notifications }`                                                                          |
| `POST /organizations`                                    | bearer                   | –             | –                                  | 201 `Organization`; creates system roles, owner membership, free subscription                               |
| `GET /organizations`                                     | bearer                   | –             | –                                  | `OrganizationSummary[]` of the caller                                                                       |
| `GET /organizations/current`                             | bearer                   | required      | `organization:read`                |                                                                                                             |
| `PATCH /organizations/current`                           | bearer                   | required      | `organization:update`              | slug conflict → 409                                                                                         |
| `DELETE /organizations/current`                          | bearer                   | required      | `organization:delete` + owner role | 204, soft delete                                                                                            |
| `GET /organizations/current/settings`                    | bearer                   | required      | `organization:read`                |                                                                                                             |
| `PUT /organizations/current/settings`                    | bearer                   | required      | `organization:update`              | strict `organizationSettingsSchema`                                                                         |
| `GET /members`                                           | bearer                   | required      | `members:read`                     | paginated                                                                                                   |
| `PATCH /members/:id`                                     | bearer                   | required      | `members:update`                   | owner role changes need an owner; last owner protected (409); self status change 403                        |
| `DELETE /members/:id`                                    | bearer                   | required      | `members:remove`                   | last owner 409; self → use `/members/me`                                                                    |
| `DELETE /members/me`                                     | bearer                   | required      | membership only                    | 204; last owner 409                                                                                         |
| `GET /permissions`                                       | bearer                   | required      | `roles:read`                       | catalog from `Permission` table (falls back to contracts)                                                   |
| `GET /roles`, `GET /roles/:id`                           | bearer                   | required      | `roles:read`                       |                                                                                                             |
| `POST /roles`                                            | bearer                   | required      | `roles:manage`                     | 201; unknown permission keys → 400; system keys → 409                                                       |
| `PATCH /roles/:id`                                       | bearer                   | required      | `roles:manage`                     | system roles: no rename (403); owner permissions cannot be reduced (403)                                    |
| `DELETE /roles/:id`                                      | bearer                   | required      | `roles:manage`                     | system role 403; role with members / pending invitations 409                                                |
| `GET /invitations`                                       | bearer                   | required      | `members:invite`                   | paginated; lazy `expired` status                                                                            |
| `POST /invitations`                                      | bearer                   | required      | `members:invite`                   | 201; owner role needs an owner; duplicate pending / existing member 409; seats → 402 `ENTITLEMENT_EXCEEDED` |
| `DELETE /invitations/:id`                                | bearer                   | required      | `members:invite`                   | 204; only pending (else 409)                                                                                |
| `GET /invitations/preview?token=`                        | public, auth throttle    | –             | –                                  | `InvitationPreview`                                                                                         |
| `POST /invitations/accept`                               | bearer                   | –             | account email must match           | 200 `OrganizationSummary`; audit `member.joined`; notifies inviter                                          |
| `GET /audit-logs`                                        | bearer                   | required      | `audit:read`                       | `listAuditLogsQuerySchema`, paginated                                                                       |
| `GET /billing/subscription`, `GET /billing/usage`        | bearer                   | required      | `organization:read`                | `Subscription`, `UsageSummary` (current UTC month)                                                          |
| `GET /billing/plans`                                     | bearer                   | –             | –                                  | `PLAN_LIMITS` catalog                                                                                       |
| `GET /analytics/dashboard`                               | bearer                   | required      | `analytics:read`                   | live counts                                                                                                 |

Status codes beyond the conventions above: `402` carries `ENTITLEMENT_EXCEEDED`; `413` `PAYLOAD_TOO_LARGE`
(body limit `BODY_LIMIT`, default 1mb); `429` `RATE_LIMITED`; `504` `INTERNAL_ERROR` ("Request timed out").

## Priority 2 — core business modules (2026-11-09)

All endpoints below are tenant-scoped (`x-organization-id` required, 403 `NOT_A_MEMBER` for foreign
organizations) unless marked otherwise, validate with the zod contracts in `@hilatech/contracts/crm`,
`/platform` and `/analytics`, and answer `404 NOT_FOUND` for any primary resource that does not belong
to the selected organization (never 403, so existence does not leak). Referenced ids inside a body
(`contactId`, `leadId`, `assigneeId`, `ownerId`) must belong to the organization — an active member for
users, a non-deleted row for contacts/leads — otherwise `400 VALIDATION_ERROR` with
`details: [{ path: '<field>', message, code: 'custom' }]`.

| Method & path                      | Permission                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /contacts`                    | `contacts:read`                               | `listContactsQuerySchema`; `search` is case-insensitive over firstName/lastName/email/company/phone; `tag`, `ownerId`, `sortBy`, `sortOrder`; soft-deleted rows excluded; items are `Contact`                                                                                                                                                                                                                                                  |
| `GET /contacts/tags`               | `contacts:read`                               | `string[]` — distinct tags of the organization's live contacts, sorted                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /contacts`                   | `contacts:create`                             | 201 `Contact`; email lower-cased; audit `contact.created`                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /contacts/:id`                | `contacts:read`                               | `ContactDetail` = `Contact` + `owner: UserSummary \| null`, `leadCount` (live leads), `conversationCount`                                                                                                                                                                                                                                                                                                                                      |
| `PATCH /contacts/:id`              | `contacts:update`                             | `updateContactSchema`; audit `contact.updated` (`metadata.changes`). `ownerId` cannot be set to `null` by the current contract                                                                                                                                                                                                                                                                                                                 |
| `DELETE /contacts/:id`             | `contacts:delete`                             | 204, soft delete (`deletedAt`); audit `contact.deleted`                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /leads`                       | `leads:read`                                  | `listLeadsQuerySchema`; `search` over title/description/contact first+last name; items are `LeadWithRelations` (`contact`, `assignee` summaries); `value` is a number                                                                                                                                                                                                                                                                          |
| `POST /leads`                      | `leads:create`                                | 201 `LeadWithRelations`; activity `created`; assigning to another member needs `leads:assign` (403 otherwise; self-assignment allowed); audit `lead.created`; notifies the assignee                                                                                                                                                                                                                                                            |
| `GET /leads/:id`                   | `leads:read`                                  | `LeadWithRelations`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PATCH /leads/:id`                 | `leads:update`                                | Records activities: `status_changed` (`{from,to,lostReason?}`), `value_changed`, `contact_linked`, `assigned`; other edits → one `updated` `{fields}` (or `alsoChanged` on the first typed entry). `lostReason` stored as given. Changing the assignee to someone else needs `leads:assign`. Audit `lead.updated` `{kind:'update'}`; no-op PATCH is not audited                                                                                |
| `DELETE /leads/:id`                | `leads:delete`                                | 204, soft delete; audit `lead.deleted`                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /leads/:id/assign`           | `leads:assign`                                | `{ assigneeId: uuid \| null }` → 200 `LeadWithRelations`; activity `assigned` `{from,to}`; audit `lead.updated` `{kind:'assign'}`; in-app notification `lead_assigned` to the assignee unless self; same assignee → no-op                                                                                                                                                                                                                      |
| `POST /leads/:id/convert`          | `leads:update`                                | `convertLeadSchema` (exactly one of `contactId` / `contact`); 200 `{ lead: LeadWithRelations, contact: Contact }`; sets `convertedAt`, links the contact, `markWon` → `status: 'won'`; activity `converted` (+ `status_changed` when won); audit `lead.updated` `{kind:'convert'}` (+ `contact.created`); already converted → 409 `CONFLICT`. New contact's owner = lead assignee or the caller                                                |
| `GET /leads/:id/notes`             | `leads:read`                                  | paginated `LeadNoteWithAuthor`, newest first                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /leads/:id/notes`            | `leads:update`                                | `{ body }` → 201 `LeadNoteWithAuthor`; activity `note_added` `{noteId, preview}`                                                                                                                                                                                                                                                                                                                                                               |
| `DELETE /leads/:id/notes/:noteId`  | `leads:update` + author **or** `leads:delete` | 204; others → 403                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /leads/:id/activities`        | `leads:read`                                  | paginated `LeadActivityWithActor`, newest first (`actor` resolved from `actorId`)                                                                                                                                                                                                                                                                                                                                                              |
| `GET /conversations`               | `conversations:read`                          | `listConversationsQuerySchema`; `search` over subject/contact name; default sort `lastMessageAt desc` (nulls last); items are `ConversationWithRelations` with `lastMessage` preview (content truncated to 200 chars)                                                                                                                                                                                                                          |
| `POST /conversations`              | `conversations:create`                        | 201; optional `initialMessage` stored as an `agent` message authored by the caller (`messageCount: 1`, `lastMessageAt` set); assigning to another member needs `conversations:assign`; audit `conversation.created`; notifies the assignee                                                                                                                                                                                                     |
| `GET /conversations/:id`           | `conversations:read`                          | `ConversationWithRelations`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `PATCH /conversations/:id`         | `conversations:update`                        | `updateConversationSchema` (`subject`, `status`, nullable `assigneeId`/`contactId`/`leadId`); audit `conversation.updated` `{kind:'update'}`; assignee change to someone else needs `conversations:assign`                                                                                                                                                                                                                                     |
| `POST /conversations/:id/assign`   | `conversations:assign`                        | `{ assigneeId: uuid \| null }`; audit `{kind:'assign'}`; notification `conversation_assigned` unless self                                                                                                                                                                                                                                                                                                                                      |
| `GET /conversations/:id/messages`  | `conversations:read`                          | `listMessagesQuerySchema` (`sortOrder` default `asc`); paginated `MessageWithAuthor`                                                                                                                                                                                                                                                                                                                                                           |
| `POST /conversations/:id/messages` | `conversations:update`                        | `createMessageSchema`; roles `agent` (authored by caller) / `customer` / `system` (no author); `assistant` → 400 `VALIDATION_ERROR` on `role` (AI replies come from the AI module); `lastMessageAt` + `messageCount` updated in the same transaction; archived → 409 `CONFLICT`; resolved → reopened to `open` (audit `{kind:'reopened'}`)                                                                                                     |
| `GET /notifications`               | `notifications:read`                          | caller's rows where `organizationId` = selected org **or** `null`; `unread=true` filter; newest first; paginated `Notification`                                                                                                                                                                                                                                                                                                                |
| `GET /notifications/unread-count`  | `notifications:read`                          | `{ unread }`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /notifications/:id/read`     | `notifications:read`                          | 200 `Notification`; idempotent; rows of other users / other organizations → 404                                                                                                                                                                                                                                                                                                                                                                |
| `POST /notifications/read-all`     | `notifications:read`                          | 200 `{ updated: number }` (caller's rows in scope)                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /notifications/preferences`   | bearer only (`@NoTenant`)                     | `NotificationPreferences` from `User.preferences.notifications` (same document as `/users/me/preferences`)                                                                                                                                                                                                                                                                                                                                     |
| `PUT /notifications/preferences`   | bearer only (`@NoTenant`)                     | replaces only the `notifications` key                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /analytics/dashboard`         | `analytics:read`                              | `dashboardQuerySchema` (`period` = `7d` \| `30d` \| `90d`, default `30d`) → `DashboardSummary`. Period = N whole UTC days ending today; series zero-filled (one bucket per day). `pipelineValue` = Σ `value` of live leads not won/lost; `wonInPeriod`/`lostInPeriod`/`wonValueInPeriod` use `updatedAt` (no `closedAt` column); `unassigned` = open/pending without assignee; `currency` = `settings.currency` if a 3-letter code, else `USD` |

Notification delivery: in-app rows are written **synchronously by the API** (`NotificationsService.notify`),
not through the `notifications` queue; in-app is on unless the user disabled the type
(`preferences.notifications.inApp[type] === false`), and an email (`generic` template on the `email`
queue, job id `notif-email-<notificationId>`) is sent only when `preferences.notifications.email[type] === true`.

## Priority 3 — AI platform (2026-11-09)

All endpoints are tenant-scoped (`x-organization-id`), validated with the zod contracts in
`@hilatech/contracts/ai`, and answer `404 NOT_FOUND` for resources of other organizations.

| Method & path                                                            | Permission                      | Notes                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /ai/providers`, `GET /ai/providers/:id`                             | `ai:config:read`                | `AiProviderConfig`; the key is never returned (`hasApiKey`, `keyLast4`)                                                                                                                                                                                                                       |
| `POST /ai/providers`                                                     | `ai:config:manage`              | 201; key encrypted (AES-256-GCM, bound to the org); real providers need `apiKey` (400); `mock` only when `AI_ALLOW_MOCK_PROVIDER=true` and never in production (400); first config becomes default; `isDefault` clears others in a transaction; duplicate name 409; audit `ai.config_created` |
| `PATCH /ai/providers/:id`                                                | `ai:config:manage`              | key rotation (`apiKey`), `clearApiKey`, `isDefault`; audit `ai.config_updated`                                                                                                                                                                                                                |
| `DELETE /ai/providers/:id`                                               | `ai:config:manage`              | 204; 409 while agents reference it (threads are detached and fall back to the default); audit `ai.config_deleted`                                                                                                                                                                             |
| `POST /ai/providers/:id/health`                                          | `ai:config:manage`              | `AiHealthCheckResult`; stores `lastHealth*`; configuration problems are reported as `status: error`, not as HTTP errors                                                                                                                                                                       |
| `GET /ai/models?provider=`                                               | `ai:config:read`                | static catalogue; mock models hidden unless the mock provider is enabled                                                                                                                                                                                                                      |
| `GET /ai/usage/summary?from&to`                                          | `ai:config:read`                | `AiUsageSummary`, default current UTC month; `estimatedCostUsd` is `null` if any successful request lacks pricing (`AI_PRICING_JSON`); `limit` = plan `aiTokensPerMonth` and tokens used this month                                                                                           |
| `GET /ai/usage/requests`                                                 | `ai:config:read`                | paginated `AiRequestLog`, filters per `listAiRequestLogsQuerySchema`                                                                                                                                                                                                                          |
| `GET/POST /ai/prompts`, `GET/PATCH/DELETE /ai/prompts/:id`               | `ai:config:read` / `manage`     | variables extracted from `{{var}}`; `version` bumps on content change; system templates cannot be deleted (409); duplicate key 409; audit `prompt_template.*`                                                                                                                                 |
| `POST /ai/prompts/:id/render`                                            | `ai:config:read`                | `{ rendered, missing: string[] }` (non-strict)                                                                                                                                                                                                                                                |
| `GET /ai/tools`                                                          | `agents:read`                   | registry tools + static `agents.delegate` / `agents.delegate_parallel` descriptors                                                                                                                                                                                                            |
| `GET/POST /assistant/threads`, `GET/PATCH/DELETE /assistant/threads/:id` | `ai:assistant:use`              | threads are private to their owner (other members get 404)                                                                                                                                                                                                                                    |
| `GET /assistant/threads/:id/messages`                                    | `ai:assistant:use`              | `user`, `assistant` (with `toolCalls`) and `tool` rows, oldest first                                                                                                                                                                                                                          |
| `POST /assistant/threads/:id/messages`                                   | `ai:assistant:use`              | JSON `{ message, usage }`, or SSE with `Accept: text/event-stream` (below). `context` ids must belong to the org (400 `context.<field>`)                                                                                                                                                      |
| `GET/POST /agents`, `GET/PATCH/DELETE /agents/:id`                       | `agents:read` / `agents:manage` | unknown tools 400 (listed in `details[0].unknown`); delegation keys stripped from `tools`; provider config and `delegateTo` must belong to the org; unique name 409; delete blocked (409) while executions are queued/running; audit `agent.*`                                                |
| `POST /agents/:id/execute`                                               | `agents:execute`                | `mode: async` (default) → **202** queued execution + job on `ai-tasks`; `mode: sync` → **200** finished `AgentExecutionDetail` (caps: 8 steps / 60s). Disabled agent 409; no provider 409 `AI_NOT_CONFIGURED`; plan limit 402; audit `agent.executed` `{ executionId, mode }`                 |
| `GET /agents/executions`, `GET /agents/executions/:id`                   | `agents:read`                   | filters `agentId`, `status`, `trigger`, `rootOnly`; detail has steps ordered by index and child executions                                                                                                                                                                                    |
| `POST /agents/executions/:id/cancel`                                     | `agents:execute`                | queued → `cancelled` now; running → Redis flag `hta:exec:cancel:<id>` (TTL 1h), status flips when the runner notices; finished → 409                                                                                                                                                          |

**SSE** (`event: <type>\ndata: <json>\n\n`, each JSON carries `type`): `message_start {messageId}` (the persisted
user message) → `text_delta {delta}` / `tool_call {toolCall}` / `tool_result {toolCallId,name,ok,summary}` →
`message_end {message,usage}` or `error {code,message}`. Pre-stream failures (402, 404, 409 `AI_NOT_CONFIGURED`, 400) are ordinary JSON errors; failures after the stream started arrive as an `error` event.

New error codes: `AI_NOT_CONFIGURED` (409), `AI_PROVIDER_ERROR` (502, `details.code` = normalised engine code),
`AI_LIMIT_EXCEEDED` (422, `details: { limit, value, max }`).

Conversation summaries: after `POST /conversations/:id/messages`, if the organization has an enabled provider
config, a job `{ kind: 'conversation_summary', targetId: conversationId, requestedByUserId, idempotencyKey:
'conv-summary-<id>-<messageCount>' }` is enqueued on `ai-tasks` with a 30s delay.

Environment: `AI_ALLOW_MOCK_PROVIDER`, `AI_PRICING_JSON`, `AI_TOOL_TIMEOUT_MS`, `AI_PROVIDER_TIMEOUT_MS`.

## Priority 5 — analytics, billing readiness, AI budget (backend, 2026-11-09)

Response schemas live in `packages/contracts/src/analytics-reports.ts` and `billing.ts`. All endpoints are
tenant-scoped (`x-organization-id`); a forged header answers `403 NOT_A_MEMBER`. No payment provider exists:
nothing charges money and no prices are defined.

### Analytics reports (`analytics:read`)

Common query (`analyticsRangeQuerySchema`): `from` / `to` (ISO datetimes, `to` exclusive; default = last 30 days
ending now; max 366 days, else `400`), `granularity` = `day` \| `week` (Monday start) \| `month` (default `day`).
Every series is zero-filled to `range.buckets` UTC buckets. Costs are `null` unless `AI_PRICING_JSON` prices the model.

| Endpoint | Response | Notes |
| -------- | -------- | ----- |
| `GET /analytics/business` | `BusinessAnalytics` | leads (created in range, current `byStatus`, `bySource`, series), funnel, conversations (status/channel/series), contacts. Funnel has no stage history: "reached" = current status at or beyond the stage. `tasks: { modelled: false }` (no Task model) |
| `GET /analytics/sales` | `SalesAnalytics` | `dealsModelled: false`: derived from leads with `value`. Open pipeline per status+currency, won/lost in range per currency (close date = `convertedAt` else `updatedAt`), win rate, avg cycle days, by source. Never sums across currencies |
| `GET /analytics/agents` | `AgentAnalytics` | executions by status, success rate = succeeded / (succeeded+failed+timed_out), p50/p95/avg `durationMs`, tokens, cost + `costCoverage`, per agent, series (`failed` includes `timed_out`) |
| `GET /analytics/automation` | `AutomationAnalytics` | workflow runs by status, success rate, durations, top failure reasons, per workflow; webhook deliveries by status, success rate (delivered / (delivered+failed)), avg attempts, failure reasons, by event |
| `GET /analytics/usage` | `UsageAnalytics` | AI requests/tokens/cost by model, agent (`agentId: null` = assistant & non-agent calls), user, series; `currentPeriod` = this month vs plan token limit and budget status |
| `GET /analytics/export?report=business\|usage&section=series\|breakdown` | `text/csv` attachment | RFC 4180; text cells starting with `= + - @` are apostrophe-prefixed (CSV injection) |

### Billing (`/billing`)

| Endpoint | Permission | Response |
| -------- | ---------- | -------- |
| `GET /plans` (no tenant) | – | `PlanCatalogEntry[]` (`key`, `name`, `rank`, `limits`, `pricing: { configured: false }`) |
| `GET /subscription` | `organization:read` | `Subscription` |
| `GET /usage` | `organization:read` | `UsageSummary`; `documents`/`storage_mb` now from the Document table (stock), `agent_executions`/`automation_runs` from their tables (month), `ai_tokens` from UsageRecord (month) |
| `GET /entitlements` | `organization:read` | `EntitlementsOverview`: per entitlement `used`, `limit`, `percent`, `state` (ok < 80% <= warning < 100% <= exceeded), `basis` (stock/period), `enforced` |
| `GET /upgrade-options` | `organization:read` | `UpgradeOptions`: pressured entitlements, higher plans with limit deltas and which pressure each would resolve, `payment.configured: false` |
| `POST /checkout` `{ plan }` | `organization:billing:manage` | always `501 PAYMENT_NOT_CONFIGURED` |
| `GET /budget` | `organization:read` | `BudgetStatus` (settings, month usage, levels, `blocked`); also raises due alerts |
| `PUT /budget` | `organization:billing:manage` | `UpdateBudgetRequest` (`monthlyTokenBudget`, `monthlyCostBudgetUsd`, `warnThresholdPct` 1-100, `hardStopEnabled`; `null` clears) → `BudgetStatus`. Hard stop needs a budget. Audited as `billing.budget_updated` |
| `GET /alerts` | `organization:billing:manage` | paginated `BudgetAlert` (scope `budget_tokens` \| `budget_cost` \| `plan_tokens`, kind `warning` \| `exceeded`); one row per org+month+scope+kind |

Enforcement: hard stop is **admission control** in the assistant (`POST /assistant/threads/:id/messages`, JSON and SSE) and
agent execute (`POST /agents/:id/execute`, sync and async). Before any provider call the API estimates the call
(prompt chars/4 + overhead + output reserve, capped by the run's token cap), checks it against the remaining monthly
budget minus calls still running (atomic Redis reservation) and refuses with `402 BUDGET_EXCEEDED`
(`details: { scope, reason: exhausted | would_exceed, used, budget, estimate }`). The reservation is released after the
run, when real usage is already recorded. A cost budget is only measurable/enforceable when pricing is configured
(`cost.enforceable`, `cost.note`). Alerts create in-app `system` notifications (`data.kind = "budget_alert"`) for members
holding `organization:billing:manage`.

## Phase 7 — tasks, deals & pipelines, companies, CSV import/export (2026-11-11)

Schemas live in `packages/contracts/src/{tasks,deals,deal-rules,import-export}.ts`. Everything is tenant-scoped
(`x-organization-id`; a forged header answers `403 NOT_A_MEMBER`), foreign ids answer `404` (or `400` when sent inside a
payload/query as a reference), mutations are audit-logged, and lists are paginated (`?page&pageSize` → `meta`).

New permission keys: `tasks:read|create|update|delete|assign`, `companies:read|create|update|delete`,
`deals:read|create|update|delete`, `pipelines:manage`, `data:import`, `data:export`. Owner/admin get all; `member` gets
read/create/update of tasks, companies and deals. Migration `20261110222218_tasks_deals_companies_imports` adds the keys to
existing system roles and creates the default pipeline for existing organizations.

### Tasks

| Endpoint | Permission | Notes |
| -------- | ---------- | ----- |
| `GET /tasks` | `tasks:read` | filters `status` (comma list), `priority`, `assigneeId` (uuid or `me`), `unassigned`, `dueFrom`/`dueTo`, `overdue`, `leadId`, `contactId`, `dealId`, `conversationId`, `search`; `sortBy` = `dueAt` \| `createdAt` \| `updatedAt` \| `priority` \| `title` + `sortOrder`. Rows are `TaskWithRelations` (assignee, createdBy, lead/contact/deal/conversation summaries, `isOverdue`) |
| `POST /tasks` | `tasks:create` | `{ title, description?, priority, dueAt?, reminderAt?, assigneeId?, leadId?, contactId?, dealId?, conversationId?, status? }`; `reminderAt` must not be after `dueAt`; giving the task to someone else needs `tasks:assign`; emits `task.created` |
| `GET/PATCH/DELETE /tasks/:id` | read / `tasks:update` / `tasks:delete` | PATCH fields are nullable to clear; `status` accepts `todo`, `in_progress`, `cancelled` (use complete/reopen for `done`); changing `reminderAt` re-arms the reminder |
| `POST /tasks/:id/complete`, `POST /tasks/:id/reopen` | `tasks:update` | complete is idempotent and emits `task.completed` once |
| `POST /tasks/bulk-assign` | `tasks:assign` | `{ taskIds[1..100], assigneeId \| null }` → `{ updated, unchanged[], notFound[] }`; the assignee is notified |

Reminders: the workers' `tasks` queue runs `reminder_tick` every minute (`TASK_REMINDER_SCHEDULER_ENABLED`); each open task
whose `reminderAt` passed gets exactly one in-app `task_reminder` notification (assignee, else creator; honours the user's
notification preferences).

### Companies

`GET/POST /companies`, `GET/PATCH/DELETE /companies/:id` (read / create / update / delete permissions of `companies:*`),
`GET /companies/:id/contacts`, `POST /companies/:id/contacts` `{ contactIds }` → `{ associated, notFound[] }`,
`DELETE /companies/:id/contacts/:contactId`. Search matches name and domain. Contacts accept `companyId` (create/update/list filter).

### Pipelines and deals

| Endpoint | Permission | Notes |
| -------- | ---------- | ----- |
| `GET /pipelines`, `GET /pipelines/:id` | `deals:read` | pipelines with ordered stages (`id, name, order, probability, kind open\|won\|lost`) and `dealCount`; the default pipeline is created on demand |
| `POST /pipelines`, `PATCH/DELETE /pipelines/:id` | `pipelines:manage` | needs one open, one won and one lost stage; delete only empty non-default pipelines |
| `POST /pipelines/:id/stages`, `PATCH/DELETE /pipelines/:id/stages/:stageId`, `PUT /pipelines/:id/stages/order` | `pipelines:manage` | return the updated pipeline; deleting a stage with deals needs `?moveDealsToStageId=` (same pipeline); reorder takes `{ stageIds }` (a permutation) |
| `GET /deals` | `deals:read` | filters `pipelineId`, `stageId`, `status`, `ownerId` (uuid or `me`), `contactId`, `companyId`, `tag`, `minValue`/`maxValue`, `expectedCloseFrom`/`To`, `search`; sort `createdAt\|updatedAt\|value\|expectedCloseAt\|title` |
| `POST /deals` | `deals:create` | `{ title, value?, currency, pipelineId?, stageId?, ownerId?, contactId?, companyId?, expectedCloseAt?, tags }`; defaults to the default pipeline / first open stage; emits `deal.created` |
| `GET/PATCH/DELETE /deals/:id` | read / `deals:update` / `deals:delete` | PATCH records `value_changed` / `owner_changed` / `updated` activities; stage changes use move |
| `POST /deals/:id/move` | `deals:update` | `{ stageId, position?, lostReason? }`: Kanban drop. Keeps both columns contiguous; won/lost stages set `status` + `closedAt`, moving back reopens. Emits `deal.stage_changed` (+ `deal.won` / `deal.lost`) |
| `GET /deals/board?pipelineId&ownerId&search&includeClosed&limitPerColumn` | `deals:read` | `{ pipeline, columns: [{ stage, deals[], count, hasMore, totals[] }], totals[] }`; totals per currency with `weightedValue` (value x stage probability) |
| `GET /deals/reports/conversion?pipelineId&from&to` | `deals:read` + `analytics:read` | `{ deals { created, open, won, lost }, winRate, avgCycleDays, stages[] (reached, rateFromPrevious, rateFromTop), valueByStage[], wonValue[], lostReasons[] }`; default range 90 days; cohort = deals created in range |
| `GET/POST /deals/:id/notes`, `DELETE /deals/:id/notes/:noteId`, `GET /deals/:id/activities` | read / `deals:update` | notes can be deleted by their author or `deals:delete` |

`/analytics/sales` switches to the real deals once an organization has any (`dealsModelled: true`, `basis: 'deals'`,
`closeDateBasis: 'closedAt'`, `stages[]` = open pipeline per stage and currency; `pipeline` and `bySource` are empty);
otherwise the lead-based report is unchanged. `/analytics/dashboard` gains `deals` and `tasks` blocks and
`leads.valueBasis`; `pipelineValue` / `wonValueInPeriod` then come from deals in the reporting currency
(other currencies are listed in `deals.otherCurrencies`). `/analytics/business` returns task statistics.

Workflow engine: new events `task.created`, `task.completed`, `deal.created`, `deal.stage_changed`, `deal.won`,
`deal.lost` (payloads carry `assigneeId` = deal owner); new step `create_task` (title/description templates, `priority`,
`assignee` user or `assignee`-of-trigger, `dueInHours`, `reminderBeforeHours`, related ids default to the trigger
payload; idempotent per execution+step). AI engine tools: `tasks.list`, `tasks.create`, `deals.list`, `deals.create`,
`deals.move` (writes are permission-gated and audited by the tool outcome hook; tools do not emit domain events).

### CSV import (`data:import` + the create permission of the entity)

Flow: upload -> (optional, repeatable) validate -> execute -> poll -> report. Entities: `contacts`, `leads`, `companies`, `deals`.

| Endpoint | Notes |
| -------- | ----- |
| `POST /imports` (multipart `file`, `entity`) | detects encoding (UTF-8 with/without BOM, UTF-16, Windows-1255 fallback) and delimiter (`, ; tab \|`); caps: 10 MB (and `MAX_UPLOAD_MB`), 50 000 rows, 100 columns, plan row limits (free 500, starter 5 000, pro 20 000, enterprise 50 000 -> `402 ENTITLEMENT_EXCEEDED`); active subscription required; at most 2 queued/running imports per organization. Returns the job plus `sampleRows`, `suggestedMapping` (English and Hebrew headers) and `fields` |
| `POST /imports/:id/validate` `{ mapping, duplicateStrategy }` | dry run: `validation { total, valid, invalid, duplicates, rows[] (capped 200, `duplicateOf { source existing\|file, row, matchedBy }`) }`; nothing is written |
| `POST /imports/:id/execute` `{ mapping, duplicateStrategy: skip\|update\|create }` | `202`, status `queued`; the workers' `imports` queue applies rows in batches of 200 (row failures isolated), updating `progress` |
| `POST /imports/:id/cancel`, `GET /imports`, `GET /imports/:id` | job: `status` uploaded/validated/queued/running/completed/failed/cancelled, `progress { processed, total, percent }`, `result { created, updated, skipped, failed }`, `error` |
| `GET /imports/:id/report`, `GET /imports/:id/report.csv` | skipped/failed rows with reasons (capped 1 000; counts are exact) |

Duplicates: contacts and leads by email, then phone (last 9 digits); companies by name; deals by title. Existing records
and earlier rows of the same file both count. All lookups are organization-scoped; owner/contact/company/pipeline/stage
references in the file are resolved by e-mail/name inside the organization only.

### CSV export (`data:export` + the read permission of the entity)

`GET /export/contacts|leads|companies|deals|tasks` accept the filters of the matching list endpoint (no pagination) and stream a
`text/csv` attachment: UTF-8 with BOM (Hebrew opens correctly in Excel), RFC 4180 quoting, cells starting with
`= + - @ tab CR` are apostrophe-prefixed (CSV injection), keyset-batched (flat memory), capped at 100 000 rows. Each export
writes a `data.exported` audit entry (entity, filters, row count). Import unescapes the apostrophe so exports round-trip.
