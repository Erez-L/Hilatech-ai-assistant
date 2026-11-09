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

| Area | Endpoints |
| --- | --- |
| Health | `GET /health`, `GET /health/ready` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email`, `POST /auth/change-password`, `GET /auth/sessions`, `DELETE /auth/sessions/:id` |
| Organizations | `GET/POST /organizations`, `GET/PATCH/DELETE /organizations/current`, `GET/PUT /organizations/current/settings` |
| Members | `GET /members`, `PATCH /members/:id`, `DELETE /members/:id` |
| Roles | `GET/POST /roles`, `GET/PATCH/DELETE /roles/:id`, `GET /permissions` |
| Invitations | `GET/POST /invitations`, `DELETE /invitations/:id`, `GET /invitations/preview?token=`, `POST /invitations/accept` |
| Users | `GET/PATCH /users/me`, `PUT /users/me/preferences` |
| Audit | `GET /audit-logs` |
| Contacts | `GET/POST /contacts`, `GET/PATCH/DELETE /contacts/:id` |
| Leads | `GET/POST /leads`, `GET/PATCH/DELETE /leads/:id`, `POST /leads/:id/notes`, `GET /leads/:id/activities`, `POST /leads/:id/convert` |
| Conversations | `GET/POST /conversations`, `GET/PATCH /conversations/:id`, `GET/POST /conversations/:id/messages` |
| Notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET/PUT /notifications/preferences` |
| Analytics | `GET /analytics/dashboard` |
| Billing | `GET /billing/subscription`, `GET /billing/usage`, `GET /billing/plans` |

## Implemented in `apps/api` (Priority 1, 2026-11-09)

Guards: `JwtAuthGuard` (global; `@Public()` skips) → `OrganizationGuard` (global; `@NoTenant()` skips) →
`PermissionsGuard` (`@RequirePermissions`). Rate limiting is global; `@AuthThrottle()` applies
`AUTH_RATE_LIMIT_MAX`. All bodies/queries are validated with the zod contracts; Swagger is generated from
the same schemas (`src/common/openapi/zod-openapi.ts`).

| Method & path | Auth | Tenant header | Permission / rule | Notes |
| --- | --- | --- | --- | --- |
| `GET /health`, `GET /health/ready` | public | – | – | terminus body shape, not enveloped |
| `POST /auth/register` | public, auth throttle | – | – | 201; optional `invitationToken` joins that org; sets refresh cookie; queues `verify_email` |
| `POST /auth/login` | public, auth throttle | – | – | 401 `INVALID_CREDENTIALS` for unknown email and wrong password alike |
| `POST /auth/refresh` | cookie `hta_refresh` | – | – | rotates; reuse → 401 `TOKEN_REUSED` + family revoked; revoked → `TOKEN_INVALID` |
| `POST /auth/logout` | cookie (optional bearer) | – | – | 204; revokes the family, clears cookie |
| `GET /auth/me` | bearer | optional | – | `Session`; invalid/non-member header → `activeOrganization: null` |
| `POST /auth/forgot-password` | public, auth throttle | – | – | always 202 `{ accepted, message }` |
| `POST /auth/reset-password` | public, auth throttle | – | – | 204; revokes all sessions |
| `POST /auth/verify-email` | public, auth throttle | – | – | 204; single use |
| `POST /auth/change-password` | bearer | – | – | 204; revokes other sessions |
| `GET /auth/sessions` | bearer | – | – | `AuthSession[]` (familyId, createdAt, lastActiveAt, expiresAt, userAgent, ipAddress, current) |
| `DELETE /auth/sessions/:familyId` | bearer | – | own sessions only | 204 |
| `GET /users/me`, `PATCH /users/me` | bearer | – | – | `AuthUser`; patch: firstName, lastName, avatarUrl |
| `GET /users/me/preferences`, `PUT /users/me/preferences` | bearer | – | – | `{ theme, locale, notifications }` |
| `POST /organizations` | bearer | – | – | 201 `Organization`; creates system roles, owner membership, free subscription |
| `GET /organizations` | bearer | – | – | `OrganizationSummary[]` of the caller |
| `GET /organizations/current` | bearer | required | `organization:read` |  |
| `PATCH /organizations/current` | bearer | required | `organization:update` | slug conflict → 409 |
| `DELETE /organizations/current` | bearer | required | `organization:delete` + owner role | 204, soft delete |
| `GET /organizations/current/settings` | bearer | required | `organization:read` |  |
| `PUT /organizations/current/settings` | bearer | required | `organization:update` | strict `organizationSettingsSchema` |
| `GET /members` | bearer | required | `members:read` | paginated |
| `PATCH /members/:id` | bearer | required | `members:update` | owner role changes need an owner; last owner protected (409); self status change 403 |
| `DELETE /members/:id` | bearer | required | `members:remove` | last owner 409; self → use `/members/me` |
| `DELETE /members/me` | bearer | required | membership only | 204; last owner 409 |
| `GET /permissions` | bearer | required | `roles:read` | catalog from `Permission` table (falls back to contracts) |
| `GET /roles`, `GET /roles/:id` | bearer | required | `roles:read` |  |
| `POST /roles` | bearer | required | `roles:manage` | 201; unknown permission keys → 400; system keys → 409 |
| `PATCH /roles/:id` | bearer | required | `roles:manage` | system roles: no rename (403); owner permissions cannot be reduced (403) |
| `DELETE /roles/:id` | bearer | required | `roles:manage` | system role 403; role with members / pending invitations 409 |
| `GET /invitations` | bearer | required | `members:invite` | paginated; lazy `expired` status |
| `POST /invitations` | bearer | required | `members:invite` | 201; owner role needs an owner; duplicate pending / existing member 409; seats → 402 `ENTITLEMENT_EXCEEDED` |
| `DELETE /invitations/:id` | bearer | required | `members:invite` | 204; only pending (else 409) |
| `GET /invitations/preview?token=` | public, auth throttle | – | – | `InvitationPreview` |
| `POST /invitations/accept` | bearer | – | account email must match | 200 `OrganizationSummary`; audit `member.joined`; notifies inviter |
| `GET /audit-logs` | bearer | required | `audit:read` | `listAuditLogsQuerySchema`, paginated |
| `GET /billing/subscription`, `GET /billing/usage` | bearer | required | `organization:read` | `Subscription`, `UsageSummary` (current UTC month) |
| `GET /billing/plans` | bearer | – | – | `PLAN_LIMITS` catalog |
| `GET /analytics/dashboard` | bearer | required | `analytics:read` | live counts |

Status codes beyond the conventions above: `402` carries `ENTITLEMENT_EXCEEDED`; `413` `PAYLOAD_TOO_LARGE`
(body limit `BODY_LIMIT`, default 1mb); `429` `RATE_LIMITED`; `504` `INTERNAL_ERROR` ("Request timed out").
