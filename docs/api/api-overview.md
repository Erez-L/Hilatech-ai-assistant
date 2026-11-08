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
