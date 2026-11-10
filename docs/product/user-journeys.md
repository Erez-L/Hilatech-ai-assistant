# User Journeys

Journeys that a user can complete **today**, with the screens and APIs involved and how each was verified. Journeys that
people would reasonably expect but cannot be completed are listed at the end so nobody plans around them.

Verification vocabulary: **E2E** = Playwright spec in `apps/web/e2e` against the running stack (last reported green
2026-11-10 in `task-status.md`; not part of CI and not re-run in this documentation pass); **API int** = integration test
against real Postgres/Redis (`apps/api/test`, `apps/workers/test`); **Unit** = vitest/jest only. AI steps always use the mock
provider; no journey has been executed against a live LLM, SMTP server or real browser session outside those specs.

## J1 — Start a workspace and invite the team (owner)

1. `/` → "Create your workspace" → `/register` (email, password ≥ 10 chars with upper/lower/digit).
2. Redirect to `/onboarding`: organization name, slug, industry, language (stored only), time zone → organization with system roles and the free plan.
3. `/dashboard` shows live counts (zeros for a new tenant, with empty states, no sample data).
4. `/team` → Invite: email + role; seat limit of the plan applies (free = 2 seats; exceeding it returns the "plan limit" message (HTTP 402)).
5. The invitation email is rendered by the workers; with `EMAIL_DRIVER=log` (default) it is printed in the worker log, so a local tester copies the link from there.

Verified: **E2E** `critical-journey` (register → onboarding → dashboard → invite → reload keeps session; protected routes redirect to login with a return path); API int `invitations.int-spec`, `organizations.int-spec`.
Gap: verification email is sent but not required; no resend.

## J2 — Join by invitation (teammate)

`/invite?token=…` previews organization, role and inviter → sign in or register with the invited email → accept → the organization appears in the switcher and the inviter gets a notification.
Verified: API int `invitations.int-spec`, `auth.int-spec`; Unit for the page. Not in E2E.

## J3 — Forgot password / verify email

`/forgot-password` always answers "if the account exists…" → link (from the email or, locally, the worker log) → `/reset-password?token=` → all sessions are revoked → login.
Verified: API int `auth.int-spec` (single use, TTL, session revocation); email templates unit-tested. Pages not in E2E.

## J4 — Work a lead from enquiry to customer (sales member)

1. `/contacts` → New contact (tags, owner).
2. `/leads` → New lead (source, value, contact); assignment to another person needs `leads:assign` (members lack it by default; self-assignment is allowed).
3. Lead detail → move through the stage stepper (`contacted`, `qualified`, `proposal`), add notes, see the activity timeline.
4. Assignee receives an in-app notification (bell).
5. Convert to contact (optionally marking won). `/conversations` → New conversation linked to the contact/lead → add messages as agent/customer/system.
6. `/dashboard` reflects the changes (counts, funnel, recent activity if the viewer has `audit:read`).

Verified: **E2E** `crm-journey` (contact → lead → assign → note → convert → conversation → message → notifications → dashboard); API int `contacts`, `leads`, `conversations`, `notifications`, `security/crm-cross-tenant`.
Not available: bulk import, Kanban board, deals, tasks, real customer messages.

## J5 — Connect an AI provider and use the assistant (admin, then any member)

1. `/settings/ai` → add provider (Anthropic or OpenAI needs a key; Bedrock needs `AI_BEDROCK_ENABLED` and an AWS identity; mock only in development) → health check → set default.
2. Without a provider, Assistant and Agents show "AI not configured" with a link, never an error.
3. `/assistant` → new thread → streaming answer; the assistant can call permitted tools (e.g. search leads, search knowledge). From a lead, "Ask assistant" opens a thread with that lead as context.
4. `/settings/ai` → Usage shows tokens (and cost only if `AI_PRICING_JSON` prices the model).

Verified with the **mock provider**: E2E `ai-journey` (provider → assistant → agent → sync run → usage); API int `assistant`, `ai-platform`, `security/ai-cross-tenant`.
Not verified: any real model output, latency, streaming behaviour against a live provider.

## J6 — Build an agent and inspect a run (operations)

`/agents/new` → instructions, tools, knowledge bases, limits → save → Run (sync for short tasks, async for long ones) → `/agents/executions/[id]` shows ordered steps (model calls, tool calls, delegations), tokens, cost/"No pricing configured", cancel while queued/running.
Verified (mock): E2E `ai-journey` (sync run); API int `agents.int-spec`; Workers int `ai-tasks.int-spec` (async, cancel, tenant boundary).
Limitation: delegation exists inside one run; there is no team builder.

## J7 — Teach the assistant about the business (knowledge manager)

`/knowledge` → create base → upload files (txt, md, csv, html, json, text PDF; ≤ 25 MB by default; plan document/storage limits) → status `uploaded → processing → ready` → "Retrieval test" tab returns scored chunks → agents and the assistant can use `knowledge.search`.
Verified (mock embeddings): E2E `knowledge-automation-journey` (upload → ready → search hit); API int `knowledge`, `security/knowledge-cross-tenant`; Workers int `document-processing`.
Not available: scanned-PDF OCR, DOCX/XLSX, de-duplication. Reprocess/download/delete UI actions are unit-tested only.

## J8 — Automate a routine (operations)

`/automations/templates` → "Notify assignee on new lead" (or another of six) → workflow created disabled → review in the editor (trigger, steps, validation panel) → enable → trigger fires on the domain event → `/automations/executions` shows each step result.
Also: schedule trigger (cron in the organization time zone), manual run, inbound webhook (`/automations/webhooks` → Inbound → copy secret once → call `POST /api/v1/hooks/:org/:endpoint`), outbound webhook subscription with delivery log and test delivery, n8n via integrations.
Verified: E2E `knowledge-automation-journey` (template → validate/enable/run; webhook secret shown once); API int + Workers int `automation.int-spec`, `security/automation-cross-tenant`.
Not verified: the minute scheduler loop end to end, real n8n, webhook UI dialogs in a browser.
Not available: drag-and-drop canvas; email/WhatsApp/task steps.

## J9 — Govern access and review activity (admin)

`/roles` → create role from the permission catalogue → `/team` → assign it → member's sidebar and actions change immediately (items are hidden, API denials are audited) → `/audit` filters by actor/action/date to review changes, denials and tenant-violation attempts.
Verified: API int `members-roles`, `security/permissions`, `security/cross-tenant`; sidebar filtering unit-tested (`app-sidebar.test.tsx`). Roles and audit pages are not in E2E.

## J10 — Watch usage and control AI spend (owner / billing manager)

`/analytics` → Business, Sales (derived from leads), Agent performance, Automation, Usage tabs; CSV export for Business and Usage → `/settings/billing` → plan usage meters, set a monthly token/cost budget with a hard stop → when exhausted the assistant and agent runs answer with a clear budget message (HTTP 402) and a billing-manager notification/alert is created → "Upgrade" explains that payments are not configured (HTTP 501).
Verified: E2E `analytics-billing-journey` (tabs → export → entitlements → budget hard stop → 402 message → checkout not configured); API int `analytics-reports`, `billing-budget`, `billing-budget-cost`.
Known gap: queued runs and workflow agent steps can overshoot the hard stop.

## J11 — Manage my account (any user)

`/settings/profile` → name, theme (light/dark/system), notification preferences (in-app/email per type), change password (other sessions revoked), active sessions with revoke. User menu → sign out.
Verified: API int `auth.int-spec`; unit tests for the preference store; page not in E2E. Language preference is stored but the UI stays English.

## Journeys that are NOT possible today

| Expected journey                                                                    | Why not                                                                                              |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A customer chats with the business (web widget, WhatsApp, email) and the AI answers | No channel connectors, no public chat endpoint, AI replies are not posted into conversations         |
| Import a CSV of leads/contacts; export contacts                                     | No import/export endpoints or UI (only analytics CSV)                                                |
| Drag a deal across pipeline stages; manage tasks and reminders                      | No Deal/Task/Pipeline models                                                                         |
| Design a workflow by dragging nodes                                                 | Editor is form-based; the flow panel is read-only                                                    |
| Define an agent team and watch it collaborate                                       | Only intra-run delegation; no team model or UI                                                       |
| Evaluate an agent against a test dataset                                            | No evaluation feature                                                                                |
| Pay, upgrade or change plan                                                         | No payment provider; `POST /billing/checkout` returns 501; there is no in-product way to change plan |
| Use the product in Hebrew / right-to-left                                           | Not implemented                                                                                      |
| Sign in with SSO or enable MFA                                                      | Not implemented                                                                                      |
| Resend a verification email                                                         | No endpoint                                                                                          |
