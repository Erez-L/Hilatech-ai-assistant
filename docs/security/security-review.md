# Security review (independent, adversarial)

Date: 2026-11-10. Reviewer: an independent engineer who did not write the code. This is a point-in-time code
review plus targeted testing; it is **not** a penetration test, audit, certification or compliance statement.

## Scope

Monorepo `hilatech-ai-assistant` at the working tree after commit `ea9ff7d`:

- `apps/api`: authentication (JWT, refresh rotation, cookies), tenancy guards and RBAC, every controller's permission
  decorators, services' `organizationId` scoping, raw SQL, uploads/downloads, inbound webhooks (`/hooks`), SSE,
  CSV export, integrations/provider secret handling, CORS/helmet/rate limits, error responses, audit logging,
  budgets/entitlements.
- `apps/workers`: job payload trust, agent execution permissions, workflow step handlers, outbound policy, webhook
  delivery.
- `packages/ai-engine` (PgVectorStore, tool executor/registry, runner, prompt-injection defences, providers),
  `packages/shared` (SSRF guard, crypto/SecretBox, webhook signatures), `packages/storage`.
- `apps/web`: token storage, markdown renderer, `dangerouslySetInnerHTML`, redirects, notification links, headers.
- Dependencies (`pnpm audit --prod`), secrets in tree/history, Dockerfiles, `infra/cdk` IAM and network.

## Method

For each area hypotheses were written down and then proved or disproved by reading the code and, where practical,
by an executable test against the real Nest app (supertest, real Postgres/Redis, mock AI provider) or a unit test.
Integration tests ran against a template copy of the test database (`sec_test`, dropped afterwards), Redis DB 9 and a
private BullMQ prefix so the shared dev database and other agents' runs were untouched. Every fixed finding has an
automated regression test (table below). Where a hypothesis was disproved it is listed under "Verified, no issue".

## Findings

Severity is the reviewer's estimate of impact in the deployed (AWS/ECS) topology.

| ID | Severity | Area | Description | Evidence | Status | Test |
|----|----------|------|-------------|----------|--------|------|
| SEC-01 | High | AI providers / SSRF | `baseUrl` of an OpenAI/Anthropic provider config was passed straight to the SDK. Any holder of `ai:config:manage` could make the API and the workers call `http://169.254.170.2/...` (ECS task-credential endpoint, which carries the S3/Bedrock task role), `http://169.254.169.254`, RFC1918 services or Redis-adjacent hosts, and read error text via the health check (`lastHealthError`). The webhook/integration paths were guarded, this one was missed. | `ai-providers.service.ts` stored the URL after `z.string().url()` only; `openai.ts`/`anthropic.ts` used it as `baseURL`. | **Fixed**: policy check on create/update (`resolveSafeTarget`), SDK `fetch` replaced by `createGuardedFetch` (scheme, all resolved addresses, no redirects) in API and workers, Bedrock never honours a stored endpoint. Residual DNS-rebinding window (SEC-14). | `test/security/review-regressions.int-spec.ts` (SEC-01), `packages/shared/src/__tests__/ssrf.test.ts` |
| SEC-02 | High | RBAC | Privilege escalation through delegated administration. A member with `roles:manage` could create or edit a role containing permissions they do not hold (including editing the system `admin` role to add `org:delete`), and a holder of `members:update` / `members:invite` could assign or invite into any non-owner role, or demote/suspend/remove members who outrank them. An admin could therefore obtain `org:delete`; a limited "people manager" could become admin-equivalent. | Reading `roles.service.ts`, `members.service.ts`, `invitations.service.ts`: only the `owner` role was special-cased. | **Fixed**: `PrivilegeRules.assertNoEscalation` (role create/update, role assignment, invitation) and an "outranks" check for member update/remove. Owners hold all permissions and are unaffected. Behaviour change: an admin can no longer create a role containing `org:delete`. | `review-regressions.int-spec.ts` (SEC-02) |
| SEC-03 | Medium | AI assistant / authorization | `POST /assistant/threads/:id/messages` accepted `context.leadId/contactId/conversationId` and injected the full record into the prompt after checking organization only. A role with just `ai:assistant:use` could read any lead/contact/conversation whose UUID it knew (UUIDs appear in notifications, URLs, exports). | `assistant.service.ts` `loadContextBlocks`. | **Fixed**: the matching `*:read` permission is required (403 otherwise). | `review-regressions.int-spec.ts` (SEC-03) |
| SEC-04 | Medium | Sessions | Access tokens were valid for up to 15 minutes after logout, "revoke session", password change/reset (documented as "revokes every other session") and refresh-reuse detection, because the `sid` claim was never checked. A stolen access token outlived every revocation control. | `jwt.strategy.ts` validated only the user's `isActive`. | **Fixed**: the session family must still have a live refresh token (one indexed query per request). | `review-regressions.int-spec.ts` (SEC-04) |
| SEC-05 | Medium/Low | Web, notifications | Open redirect / off-origin links. `safeNextPath` and the notification-menu check accepted `/\evil.example` (browsers normalise it to `//evil.example`; `new URL('/\\evil.com', origin).origin === 'http://evil.com'`), so `/login?next=/\evil.example` redirected after login. The workers' `send_notification` step only required a leading `/`, so a templated link such as `//evil.example` (workflow templates can interpolate webhook payload fields) became an in-app and e-mailed link. | `apps/web/src/lib/navigation.ts`, `notifications-menu.tsx`, `step-handlers.ts`. | **Fixed** with a shared `isSafeAppPath` (web copy + `@hilatech/shared`), also enforced in `NotificationsService`. The e-mail `resolveLink` still accepts absolute http(s) links (see Residual). | `apps/web/src/lib/__tests__/navigation.test.ts`, `packages/shared/src/__tests__/shared.test.ts`, `review-regressions.int-spec.ts` (SEC-05) |
| SEC-06 | Low | Prompt injection | `dataBlock` neutralised only the literal `</data>`; `</data >`, `< /data>`, `</DATA\n>` let untrusted tool/document text close its block and be read as instructions. | `context-builder.ts`. | **Fixed** (all closing-tag variants neutralised). The defence remains a model-level convention, not a hard boundary (see Residual). | `packages/ai-engine/src/__tests__/context.test.ts` |
| SEC-07 | Medium | Agents / delegation | A read-only agent (`allowWrite:false`) with delegation enabled and an empty `delegateTo` (= any agent) could delegate to a write-enabled agent and thereby perform writes the delegator may not (confused deputy after a prompt injection). Delegates already inherited the user's permissions; they did not inherit the delegator's write restriction. | `runner.ts` `delegateOnce` ran the child with the target's own `allowWrite`. | **Fixed**: `allowWrite` of a delegate = target AND delegator. Admins who want write delegation must enable it on both agents. | `packages/ai-engine/src/__tests__/runner.test.ts` (SEC-07) |
| SEC-08 | Low | Secrets / repo hygiene | `dump.rdb` (a local Redis dump containing BullMQ job payloads: invitation/reset e-mail jobs, tokens, e-mail addresses) is tracked in git and present in four commits. | `git ls-files dump.rdb`, `git log -- dump.rdb`. | **Partially fixed**: `dump.rdb`/`*.rdb` added to `.gitignore`. **Open**: the file is still tracked and in history; run `git rm --cached dump.rdb`, purge history if the repository leaves this machine, and invalidate any tokens in it (they are single-use/expiring dev data). | n/a |
| SEC-09 | Medium (dev-dep chain) | Dependencies | `pnpm audit --prod`: 6 advisories (4 high, 2 moderate): `multer >=2.0.0 <2.5.0` (DoS through a pending async `fileFilter`; **not reachable**, no `fileFilter` is configured), `zod <4.6.6` GHSA-mrhx-c7xc-m3w5 (memory exhaustion on oversized constrained collections; bounded by `BODY_LIMIT`), `postcss` x4 through `next` (build-time CSS stringify/source-map issues; not reachable at runtime). | `pnpm audit --prod --json` (see commands). | **Open / accepted for now** (not blanket-upgraded as instructed): bump `@nestjs/platform-express` (multer >= 2.5.0), `next` (postcss) and plan the zod 4 migration. | n/a |
| SEC-10 | Low | Auth | Brute-force control is per IP only (`AUTH_RATE_LIMIT_MAX`, in-memory throttler storage per API instance). No per-account lockout or backoff; a distributed attacker or N API replicas multiplies the budget. Argon2id keeps the per-guess cost high. | `app-throttler.guard.ts`, `app.module.ts` (default in-memory storage). | **Open**: use the Redis throttler storage and add a per-email limiter. | n/a |
| SEC-11 | Low | Auth | `POST /auth/register` answers 409 for an existing e-mail (account enumeration), unlike login/forgot-password. Rate limited. | `auth.service.ts` `register`. | **Accepted** (usability trade-off, common); switch to "check your e-mail" flow if enumeration matters. | n/a |
| SEC-12 | Low | Web | The Next.js app sets `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` but no `Content-Security-Policy` and no HSTS (HSTS is expected from the ALB/CDN). XSS surface is small (React escaping, markdown renderer emits elements only, `dangerouslySetInnerHTML` only for a constant theme script) but a CSP would contain future mistakes. | `apps/web/next.config.ts`. | **Open** (nonce-based CSP needs a middleware change). | n/a |
| SEC-13 | Low | Inbound webhooks | A signature without `x-hilatech-timestamp` is replayable, and the HMAC key is the stored `SHA-256(secret)`, so anyone who can read the database can forge requests. Failures are uniform 401s, constant-time, rate limited and audited. | `webhook-signature.ts`, `hooks.service.ts`. | **Accepted / documented**: require the timestamp header for new endpoints in a future change. | n/a |
| SEC-14 | Low | SSRF residual | `createGuardedFetch` validates the DNS answer, but the SDK re-resolves when it connects (DNS-rebinding race with TTL 0). Webhook/workflow/integration requests use DNS-pinned `safeRequest` and are not affected. ECS tasks have unrestricted egress (`allowAllOutbound`). | `ssrf.ts`; `infra/cdk/lib/stacks/network-stack.ts`. | **Open**: pin via an undici dispatcher, or restrict task egress to VPC endpoints/known providers. | n/a |
| SEC-15 | Info | Authorization model | (a) `agents:read` exposes execution steps (tool outputs may contain CRM data the reader cannot read through `leads:read`). (b) A workflow author (`automations:manage`) can cause writes (lead updates, write-enabled agent runs) that the author's own CRM permissions would not allow; automation-triggered agents run with the admin-configured tool grants by design, and a webhook payload feeds agent input (prompt-injection surface, mitigated by the tool permission layer, `allowWrite` and `<data>` blocks). | `agent-executions.service.ts`, `step-handlers.ts`. | **Accepted by design**; treat `agents:read` and `automations:manage` as privileged and keep write-enabled agents off public webhook workflows. | n/a |
| SEC-16 | Info | Agents | `knowledgeBaseIds` on an agent is not checked to belong to the organization. Harmless: every retrieval query is also filtered by `organizationId`, so foreign ids match nothing. | `agents.service.ts`, `pgvector-store.ts`. | **Accepted** (validate for cleanliness later). | n/a |
| SEC-17 | Info | Infra | RDS URL uses `sslmode=no-verify` (TLS without certificate verification inside the VPC); documented in the stack. | `infra/cdk/lib/stacks/data-stack.ts`. | **Accepted** (hardening path documented there). | n/a |

## Verified, no issue (hypotheses disproved)

- **Tenant scoping**: all `findUnique/update/delete` by id in services are preceded by an organization-scoped load;
  the id-only queries left are user-scoped (`users`, `auth`) or follow a scoped lookup. Cross-tenant foreign ids in
  bodies (assignee, contact, lead, provider config, delegation targets, roles) are validated against the tenant.
- **Raw SQL**: `PgVectorStore`, analytics and `contacts.tags` use tagged templates with bound parameters; the only
  `Prisma.raw` inputs are compile-time constants or a validated enum (`granularity`). Every statement filters on
  `organizationId`.
- **JWT/refresh**: HS256 pinned, `none` and missing claims rejected, atomic rotation with reuse detection that
  revokes the family, opaque 48-byte tokens stored as SHA-256, cookie `httpOnly; SameSite=Lax; path=/api/v1/auth`,
  `Secure` enforced in production by env validation. Refresh is cookie-only.
- **Guards**: global throttler, JWT, organization and permissions guards; every controller method outside the
  documented `@Public/@NoTenant` set carries `@RequirePermissions`. Organization is resolved from active membership,
  not from the header alone; violations are audited.
- **Uploads/downloads**: size limit enforced by Multer, extension allow-list plus content sniffing, server-generated
  tenant-prefixed storage keys, key validation and traversal checks, download is an authenticated attachment with
  `nosniff` and `CSP: sandbox`.
- **Secrets**: AES-256-GCM `SecretBox` with the organization id as AAD (envelopes cannot be moved between tenants);
  provider keys and integration secrets are write-only (last four / key names only); webhook secrets are shown once;
  inbound endpoint secrets are stored hashed. `.env` is git-ignored; no key-like strings in the tree or the last 20
  commits (pattern scan).
- **Outbound HTTP**: private/loopback/link-local/CGNAT/mapped IPv6 ranges rejected, DNS-pinned connections, no
  redirects, n8n credentials sent only to the configured origin. Workers use the same policy.
- **Workers**: every processor re-reads its target with the payload's `organizationId` (execution, workflow,
  delivery; delivery secrets are decrypted with the payload's org as AAD), agent runs use the triggering user's
  *current* membership permissions, tool calls pass allow-list, permission, risk, input-validation and timeout
  checks, `dangerous` tools never execute, delegation depth/count/cycle limits hold.
- **CSV export** neutralises `= + - @ \t \r` (numbers unaffected). **Markdown renderer** builds React elements only
  and allows `http(s)`/`mailto` links.
- **Containers/IaC**: images run as a non-root user, no secrets baked in; task roles are scoped (S3 object actions on
  the documents bucket, Bedrock invoke on explicit model/profile ARNs), tasks in private subnets, DB/Redis reachable
  only from app security groups, S3 public access blocked, secrets in Secrets Manager.

## Commands run and results

- `pnpm --filter @hilatech/{api,workers,web,ai-engine,shared} typecheck`: clean.
- `eslint .` in `apps/api`, `apps/workers`, `apps/web`, `packages/shared`, `packages/ai-engine`: no errors.
- API unit: 35 suites / 230 tests pass. Workers unit (`pnpm test`): 85 pass. Shared: 62 pass. AI engine: 91 pass.
  Web (vitest): 151 pass.
- API integration (`TEST_DATABASE_URL=.../sec_test TEST_REDIS_URL=redis://localhost:6379/9 TEST_BULLMQ_PREFIX=bull-test-sec`):
  27 suites / 359 tests pass, including the new 22 in `test/security/review-regressions.int-spec.ts`.
  Workers integration: 4 suites / 46 tests pass.
- `pnpm audit --prod`: 6 vulnerabilities (see SEC-09).

## NOT reviewed

- The deployed AWS environment (WAF rules, actual IAM, security-group drift, CloudTrail), TLS termination, DNS.
- Penetration testing or fuzzing of the running stack, DoS/load behaviour, Redis/Postgres server hardening.
- E-mail templates' HTML escaping (user-controlled names and bodies are rendered into HTML e-mail), SMTP driver.
- The Bedrock/Anthropic/OpenAI provider adapters beyond endpoint handling; model-side robustness to prompt injection.
- The S3 storage driver at runtime, S3 bucket policies in a live account, the Next.js runtime/CVEs beyond `pnpm audit`.
- Git history beyond the 20 newest commits for key patterns; supply-chain provenance of dependencies.
- Playwright e2e flows and the `/tests/load` harness.

## Residual risks

- Prompt-injection defences (data blocks, tool permission layer, `allowWrite`, human permission intersection) reduce
  blast radius but cannot make a model reliably ignore injected text; keep write tools opt-in and review agents that
  read untrusted content (webhook payloads, customer messages, uploaded documents).
- SEC-08/09/10/12/13/14 above remain open or accepted. In particular the repository still tracks `dump.rdb`.
- `OUTBOUND_ALLOWED_HOSTS` bypasses the range check by design: keep it minimal and admin-only.
- The e-mail renderer still turns any absolute http(s) `ctaUrl` into a button; all current producers pass
  app-relative links that are validated, but a future producer must not pass tenant-controlled absolute URLs.
- Owner role invariants rely on the database row carrying every permission (the API reads `role.permissions`); a new
  permission added to the catalog must be migrated onto the owner role.
