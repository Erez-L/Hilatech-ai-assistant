# Design System

Source of truth: `packages/ui` (`@hilatech/ui`), consumed by `apps/web` as TypeScript source. Tokens live in
`packages/ui/src/styles.css`; components in `packages/ui/src/components` and `packages/ui/src/charts`. This document
describes what exists; nothing here is aspirational. Tests: `packages/ui/src/__tests__` (8 files / 30 tests, passing
2026-11-10) cover button, combobox, form-field, json viewer, segmented control + timeline, empty/error states, table and
tag input. Other components (dialog, dropdown, charts, sheet, sidebar…) are exercised only indirectly through web tests.

## Stack and principles

- Tailwind CSS 4 (`@import 'tailwindcss'`, `@theme inline`), Radix UI primitives for behaviour and accessibility,
  `class-variance-authority` for variants, `lucide-react` icons, `recharts` for charts, `sonner` for toasts.
- **Semantic tokens, two explicit palettes.** Components use `bg-surface`, `text-fg-muted`, `border-border`… never raw
  colours. `.dark` on `<html>` swaps the CSS variables (the dark palette is hand-tuned, not an inversion).
- One accent (deep teal) on cool neutral greys. Status colours are reserved for state, never decoration.
- Font: Inter variable (self-hosted `apps/web/src/app/fonts`), base size 15 px (`0.9375rem`), line height 1.5, tabular
  numerals via the `tabular` utility.

## Colour tokens

| Token (utility suffix)                          | Light                                         | Dark                                          | Use                                |
| ----------------------------------------------- | --------------------------------------------- | --------------------------------------------- | ---------------------------------- |
| `bg`                                            | `#f4f5f7`                                     | `#0e1116`                                     | Page background                    |
| `surface`                                       | `#ffffff`                                     | `#151a21`                                     | Cards, inputs, tables              |
| `surface-muted`                                 | `#eef0f3`                                     | `#1b212a`                                     | Hover, zebra, neutral badge        |
| `surface-raised`                                | `#ffffff`                                     | `#1b212a`                                     | Popovers, dialogs                  |
| `border` / `border-strong`                      | `#e2e5ea` / `#c9ced7`                         | `#262d37` / `#353e4a`                         | Dividers / emphasised borders      |
| `fg` / `fg-muted` / `fg-subtle` / `fg-inverted` | `#171a20` / `#5b6472` / `#8a93a1` / `#ffffff` | `#e8ebef` / `#9aa4b2` / `#6b7785` / `#0e1116` | Text                               |
| `accent` / `accent-hover` / `accent-fg`         | `#0b7a75` / `#09645f` / `#ffffff`             | `#3fbfb2` / `#5bcdc1` / `#06231f`             | Primary actions, links, focus ring |
| `accent-soft` / `accent-soft-fg`                | `#e2f3f1` / `#075f5b`                         | `#11302d` / `#7adbd1`                         | Selected, accent badge             |
| `success` (+ `-soft`, `-soft-fg`)               | `#1f8a4c`                                     | `#47b872`                                     | Won, active, verified              |
| `warning` (+ soft)                              | `#b4690e`                                     | `#e0a040`                                     | Pending, nearing limit             |
| `danger` (+ `-hover`, soft)                     | `#c8322b`                                     | `#ef6b63`                                     | Destructive, failed, lost          |
| `info` (+ soft)                                 | `#2a78d6`                                     | `#3987e5`                                     | New, informational                 |
| `ring`                                          | `#0b7a75`                                     | `#3fbfb2`                                     | Focus outline (2 px, offset 2 px)  |
| `overlay`                                       | `rgb(16 20 26 / .45)`                         | `rgb(0 0 0 / .6)`                             | Dialog/sheet scrim                 |

Chart series `chart-1…8` (fixed order, comment in CSS says CVD-validated): light `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #6250d6 #e34948`;
dark variants are in `styles.css`. Grid/track colour `#e2e5ea` / `#262d37`. The CVD-validation claim comes from the source
comment; no validation artefact is stored in the repository.

## Shape, elevation, motion

- Radii: `xs 4`, `sm 6` (buttons, inputs), `md 8`, `lg 12` (cards), `xl 16`, `2xl 24` px.
- Shadows: `xs`, `sm`, `popover`, `dialog` (each has a dark-theme variant).
- Type scale is Tailwind's plus `text-2xs` (11 px / 16 px). Page titles use `PageHeader`; section titles `SectionHeader`.
- Animations: `fade-in` 150 ms, `scale-in` 150 ms, `slide-in-left` 200 ms (mobile nav), `shimmer` 1.6 s (skeleton).
  `prefers-reduced-motion: reduce` collapses all animation and transition durations.
- Selection colour uses accent-soft; `:focus-visible` always shows the ring; disabled controls get `not-allowed`.

## Component inventory (`@hilatech/ui`)

| Group               | Components                                                                                                                                                                                                                                                                                                                                                                                                                        | Notes                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Actions             | `Button` (variants `primary`, `secondary`, `ghost`, `danger`, `danger-outline`, `link`; sizes `sm` 32 px, `md` 36 px, `lg` 44 px; `loading`, `leadingIcon`, `trailingIcon`, `asChild`), `IconButton`                                                                                                                                                                                                                              | Loading keeps width and disables the button                                          |
| Form                | `Input`, `Textarea`, `AutosizeTextarea`, `SearchInput`, `NativeSelect`, `Select` (Radix), `Combobox`, `TagInput`, `Checkbox`, `Switch`, `SegmentedControl`, `Label`, `FormField` (label + description + error wiring)                                                                                                                                                                                                             | Inputs are 36 px high, `rounded-sm`                                                  |
| Data display        | `Card` (+ Header/Title/Description/Content/Footer), `Table` family (`TableHead`, `SortableHead`, `TableEmptyRow`, `TableSkeletonRows`, `sortRows`), `Badge` (neutral, outline, accent, success, warning, danger, info; optional dot), `StatusBadge` (maps known status strings to tones), `Avatar` (xs–lg, initials fallback), `StatCard`, `Meter` (progress), `Timeline`/`TimelineItem`, `CodeBlock`, `JsonViewer`, `Pagination` | `StatusBadge` knows member, invitation, subscription, lead and conversation statuses |
| Feedback            | `Alert` (info, success, warning, danger, neutral), `EmptyState`, `ErrorState` (with retry), `Skeleton`, `Spinner`, `Toaster`/`toast` (sonner)                                                                                                                                                                                                                                                                                     |                                                                                      |
| Overlays            | `Dialog` (sizes `sm`–`xl`), `ConfirmDialog`, `Sheet` (left/right, `closeOutside`), `Popover`, `Tooltip`, `DropdownMenu` (full Radix surface)                                                                                                                                                                                                                                                                                      |                                                                                      |
| Navigation / layout | `Tabs`, `Sidebar`, `TopBar`, `PageHeader`, `SectionHeader`, `Logo` (`LogoMark`, `Wordmark`)                                                                                                                                                                                                                                                                                                                                       |                                                                                      |
| Charts              | `AreaChart`, `BarChart`, `LineChart`, `DonutChart`, shared `CHART_SERIES_COLORS`, tooltip and axis helpers                                                                                                                                                                                                                                                                                                                        | Series colours assigned by position from `chart-1…8`                                 |
| Utilities           | `cn`, `formatNumber`, `formatCompact`, `formatPercent`, `formatCurrency`, `formatBytesFromMb`, `initials`                                                                                                                                                                                                                                                                                                                         | Formatters accept a `locale` argument, default `en`                                  |

## App-level composites (`apps/web/src/components`)

| Component                                                                               | Purpose                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shell/app-shell.tsx`, `app-sidebar.tsx`, `nav.ts`                                      | Authenticated frame. Sidebar from `NAV_SECTIONS` with permission filtering (items hidden, not disabled). Below the `lg` breakpoint navigation moves into a left `Sheet`. "Skip to content" link is the first focusable element |
| `shell/org-switcher.tsx`, `user-menu.tsx`, `theme-toggle.tsx`, `notifications-menu.tsx` | Organization switch, account menu (profile, organization settings, sign out), light/dark/system, bell with unread count                                                                                                        |
| `common/query-state.tsx`                                                                | Standard loading / error-with-retry / empty / success rendering for a react-query result                                                                                                                                       |
| `common/permission-gate.tsx`, `hooks/use-can.ts`                                        | Renders a "restricted" state or hides controls when the permission is missing                                                                                                                                                  |
| `common/data-table.tsx`                                                                 | Table with sorting/pagination wiring used by the analytics tabs and billing alerts                                                                                                                                             |
| `common/upcoming-feature.tsx`                                                           | Placeholder for unbuilt modules. **Currently unused by any route**; kept with a unit test                                                                                                                                      |
| `ai/*`                                                                                  | `AiNotConfigured`, `BudgetExceeded` (HTTP 402 handling), markdown renderer, tool chips/picker, status badges                                                                                                                   |
| `automation/*`, `knowledge/*`, `crm/*`, `integrations/*`                                | Domain pickers, dialogs and panels                                                                                                                                                                                             |

## Behavioural conventions

- **Every data view has four states**: loading (skeleton), empty (`EmptyState` with next action), error (`ErrorState`
  with retry, API error envelope mapped to a message), populated. Permission-less access renders a "You don’t have access to this page" `EmptyState`
  (`PermissionGate`) rather than a blank page.
- **Forms**: react-hook-form + the shared zod schema; server `VALIDATION_ERROR` details are mapped onto fields
  (`lib/forms/server-errors.ts`). Destructive actions use `ConfirmDialog`. Success/failure feedback is a toast.
- **Secrets are shown once** (webhook secrets) in a dedicated dialog; provider keys are write-only (`hasApiKey`, `keyLast4`).
- **No fabricated data**: unconfigured capabilities show "not configured" (AI provider, pricing, payments, unlinked
  integrations).
- **Dark mode**: `ThemeProvider` stores `light | dark | system` in local storage and applies the `.dark` class before hydration
  through an inline script to avoid a flash. A user preference is also saved server-side (`/users/me/preferences`).

## Known gaps

- Hebrew/RTL is implemented (see `docs/development/i18n.md`), but only verified with automated tests, e2e and
  screenshot review of key pages; there is no visual-regression suite, so new screens need an RTL check by hand.
  Remaining i18n gaps (server-generated English text, no Hebrew email/AI prompts) are listed in `i18n.md`.
- No Storybook or visual-regression suite; no automated accessibility audit; dark-mode contrast and responsive layouts were
  **not** visually verified (`task-status.md`).
- No tokens for spacing or z-index beyond Tailwind defaults; no documented density modes.
- Branding colour in organization settings is stored but does not re-theme the app.
- Component test coverage is partial (see top).
