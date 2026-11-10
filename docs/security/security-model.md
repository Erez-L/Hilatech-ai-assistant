# Security Model

## Principles

Security by design, least privilege, tenant isolation enforced server-side, no secrets in code,
logs, bundles or API responses.

## Authentication

- Argon2id password hashing.
- Access JWT (15 min) signed with `JWT_ACCESS_SECRET` (HS256 only); kept in browser memory only. Every request
  re-checks that the user is active **and that the session (`sid` = refresh-token family) is not revoked**, so
  logout, "revoke session", password change/reset and refresh-reuse detection end access immediately rather than
  at token expiry.
- Opaque refresh token in an `httpOnly; Secure; SameSite=Lax` cookie scoped to `/api/v1/auth`,
  stored as SHA-256, rotated on every refresh. Reuse of a rotated token revokes the whole session
  family and writes an audit event.
- Password reset and email verification use single-use hashed tokens with TTLs.
- Login and password-reset endpoints have stricter rate limits (`AUTH_RATE_LIMIT_MAX`).
- Account enumeration is avoided: forgot-password always returns 202; login failures return the same
  error for unknown email and wrong password.

## Authorization

- Organization context derived from validated membership (`OrganizationGuard`), never from the
  client-supplied id alone.
- `PermissionsGuard` + `@RequirePermissions()` on every tenant-scoped endpoint.
- Roles per organization; `owner` cannot be downgraded by non-owners; last owner cannot be removed.
- No privilege escalation through delegated administration: creating or editing a role, assigning a role to a
  member and inviting into a role require holding every permission that role carries; changing, suspending or
  removing a member requires outranking (holding all permissions of) their current role. Owners hold every
  permission and are unrestricted.
- Records an AI assistant loads as context (`leadId`, `contactId`, `conversationId`) require the same read
  permission as the REST endpoints; agent/assistant tool calls run with at most the triggering user's permissions
  (ADR-010) and `allowWrite` is inherited downwards on delegation (a delegate never writes unless its delegator may).

## Tenant isolation

- Services receive `TenantContext` and scope all queries by `organizationId`.
- Cross-tenant tests (`apps/api/test/security/*.int-spec.ts`) assert 403/404 for foreign resources.
- Background jobs carry `organizationId`; workers never run unscoped queries.

## Outbound requests (SSRF)

Every server-initiated request to a tenant-supplied address goes through the SSRF policy in `@hilatech/shared`
(`https` only; every resolved address must be public; no redirects; loopback/`http` only outside production;
`OUTBOUND_ALLOWED_HOSTS` is the admin-controlled exception list): outbound webhooks, workflow `http_request` /
`n8n_trigger` steps, integration tests (DNS-pinned `safeRequest`) and **AI provider `baseUrl`s** (checked at
create/update and on every SDK request through `createGuardedFetch`). Bedrock ignores any stored endpoint override.
Residual: SDK-based calls re-resolve DNS when they connect (rebinding window); see `security-review.md`.

## Transport & headers

Helmet, strict CORS (`CORS_ORIGINS`), request timeouts, body size limits, rate limiting
(`@nestjs/throttler`), `x-request-id` on every response.

## Input handling

All input validated by zod contracts; app-relative links (notifications, post-login `next`) must stay on the
application origin (`isSafeAppPath`: no `//host`, no `/\host`, no control characters); Prisma parameterized queries; uploads validated by type and
size; retrieved documents and AI outputs treated as untrusted input (prompt-injection defences in
the AI engine: tool permission layer, instruction/content separation, output validation).

## Secrets

`.env.example` documents variables; startup validation refuses placeholder secrets in production.
Organization AI credentials are encrypted with `CREDENTIALS_ENCRYPTION_KEY` (AES-256-GCM) and never
returned to clients. Logs redact passwords, tokens, cookies and API keys.

## Audit

Authentication events, permission denials, tenant-violation attempts, organization/member/role
changes and sensitive CRM/AI operations are written to `AuditLog` with actor, IP, user agent and
request id.
