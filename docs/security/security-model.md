# Security Model

## Principles
Security by design, least privilege, tenant isolation enforced server-side, no secrets in code,
logs, bundles or API responses.

## Authentication
- Argon2id password hashing.
- Access JWT (15 min) signed with `JWT_ACCESS_SECRET`; kept in browser memory only.
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

## Tenant isolation
- Services receive `TenantContext` and scope all queries by `organizationId`.
- Cross-tenant tests (`apps/api/test/security/*.int-spec.ts`) assert 403/404 for foreign resources.
- Background jobs carry `organizationId`; workers never run unscoped queries.

## Transport & headers
Helmet, strict CORS (`CORS_ORIGINS`), request timeouts, body size limits, rate limiting
(`@nestjs/throttler`), `x-request-id` on every response.

## Input handling
All input validated by zod contracts; Prisma parameterized queries; uploads validated by type and
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
