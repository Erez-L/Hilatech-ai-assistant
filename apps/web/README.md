# @hilatech/web

Next.js 15 (App Router) dashboard for HilaTech AI Assistant. Talks only to the API over
`${NEXT_PUBLIC_API_URL}/api/v1` using the zod contracts from `@hilatech/contracts` and the design
system from `@hilatech/ui` (consumed as TypeScript source via `transpilePackages`).

## Scripts

| Script                            | What it does                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @hilatech/web dev` | `next dev -p 3000`                                                                                     |
| `build` / `start`                 | production build with `output: 'standalone'` (see `infrastructure/docker/web.Dockerfile`)              |
| `lint` / `typecheck`              | ESLint 9 flat config (`@hilatech/config/eslint/next.js` + `@next/eslint-plugin-next`) / `tsc --noEmit` |
| `test`                            | Vitest + Testing Library (API client, session store, forms, components)                                |
| `test:e2e`                        | Playwright; specs skip themselves unless `E2E_BASE_URL` points at a running stack                      |

Environment: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL` (root `.env` or `apps/web/.env.local`).

## Structure

```
src/app
  (marketing)/            landing page
  (auth)/                 login, register (?invite=token), forgot/reset password, verify-email, invite
  (onboarding)/onboarding create the first (or another) organization
  (app)/                  everything behind AuthGate + AppShell (dashboard, team, roles, audit, settings/*, placeholders)
src/lib/api               client.ts (ApiError, refresh dedup + retry), typed resource modules, query keys, local types
src/hooks                 react-query hooks (queries.ts), useCan()
src/stores                zustand: session (access token in memory, active organization id in localStorage), preferences
src/components            auth gate, app shell (sidebar, top bar, org switcher, user menu, notifications), shared states
e2e/                      Playwright critical journey
```

### Session model

- Access token lives only in memory (`useSession`). The refresh token is an httpOnly cookie, so every
  request uses `credentials: 'include'`.
- `AuthGate` (used by the `(app)` and `(onboarding)` layouts) calls `POST /auth/refresh` once when no
  token is in memory, redirects to `/login?next=…` on failure, then loads `GET /auth/me` keyed by the
  active organization to resolve permissions. Users with no organization are sent to `/onboarding`.
- The API client refreshes once on 401 (deduplicated across concurrent requests), retries the
  original request, and clears the session when the refresh fails.
- The active organization id is persisted in `localStorage` and sent as `x-organization-id`.
  Switching organizations drops all tenant-scoped query caches (`['org', …]`).
- `useCan(permission)` reads `Session.permissions` to hide or disable actions. Pages are additionally
  wrapped in `PermissionGate`, and the sidebar hides entries the role cannot open.

### Data states

Every data view renders loading skeletons, an empty state, an error state with retry (`QueryState`),
and the success view. Mutations show toasts; member/invitation/role mutations patch the cache
optimistically where the result is unambiguous. Placeholder areas (leads, contacts, conversations,
assistant, agents, knowledge, automations, integrations, analytics) render a single shared
`UpcomingFeature` empty state — never static mock data.

## Visual direction

The product is an operational assistant for small and mid-sized businesses: it should feel like a
calm, trustworthy control room rather than a consumer chat app.

- **Palette.** Cool neutral greys (`#f4f5f7` canvas, white surfaces, `#171a20` ink) with one deep
  teal accent (`#0b7a75`; `#3fbfb2` on dark). Teal reads as "communication and reliability" without
  the indigo-violet default of most SaaS kits. Status colours (success/warning/danger/info) are
  reserved for state and never used decoratively. Dark mode is a separately tuned palette, not an
  inversion; both are defined as CSS variables in `packages/ui/src/styles.css` and exposed through
  Tailwind `@theme inline` tokens (`bg-surface`, `text-fg-muted`, `border-border`, …).
- **Type.** Inter (variable, self-hosted under the OFL in `src/app/fonts`) for everything; display
  headlines are tight-tracked semibold, data uses tabular figures. No second family.
- **Structure over decoration.** Borders and hairline dividers carry hierarchy; shadows are reserved
  for floating layers (menus, dialogs). Radii step with elevation: 6px controls, 12px cards, 16px
  dialogs. Motion is limited to menus/dialogs appearing and a shimmer on skeletons, and respects
  `prefers-reduced-motion`.
- **Landing.** Left-aligned hero with a single memorable element — a short example of the assistant
  handling one enquiry end to end (labelled as an example). Capabilities are laid out as one bordered
  grid with hairline dividers rather than individual floating cards.
- **Charts.** Recharts wrappers in `@hilatech/ui` use a CVD-validated categorical order
  (`--chart-1…8`), thin marks, hairline grids and token-coloured text.

## Contract gaps and backend assumptions

Shapes the UI consumes that are not yet in `@hilatech/contracts` are declared in
`src/lib/api/types.ts` and should move into the package once confirmed:

- `GET /permissions` → `{ key, group, description }[]`
- `GET /auth/sessions` → `{ familyId, userAgent, ipAddress, createdAt, lastUsedAt, current }[]`
- `GET /analytics/dashboard` → `{ members, pendingInvitations, leads, contacts, conversations, openConversations }`
- `PUT /users/me/preferences` body `{ theme: 'light'|'dark'|'system', locale: 'en'|'he', notifications: { email, inApp } }`
  (the full object is always sent). There is no read endpoint for preferences, so the last known
  values are mirrored in `localStorage` (`usePreferences`).
- `PATCH /users/me` body `{ firstName?, lastName?, avatarUrl?: string | null }` → `AuthUser`.

Other assumptions the UI makes about the API:

- `GET /auth/me` returns `activeOrganization: null` and `permissions: []` when no `x-organization-id`
  header is sent; the client then selects an organization and re-fetches with the header.
- `POST /organizations` and `POST /invitations/accept` change membership; the client calls
  `POST /auth/refresh` afterwards to refresh `organizations` and then selects the new organization.
- `GET /members` accepts `search`, `page`, `pageSize` and returns `meta: PaginationMeta`.
- `DELETE /members/me` lets a non-owner leave the organization.
- `GET /invitations/preview?token=` is public and returns `status` so expired/revoked links render a
  clear message; `POST /invitations/accept` requires a signed-in user and returns the new `Member`.
- `GET /notifications?unread=true` may 404 until a later milestone; the bell renders an empty state.
- Validation errors are `400 VALIDATION_ERROR` with zod issues (`[{ path: string[], message }]`, or
  `{ issues }` / zod `flatten()` output) in `details`; they are mapped onto form fields.
