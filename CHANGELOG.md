# Changelog

All notable changes to this project are documented here. Format: Keep a Changelog; versioning: SemVer.

## [Unreleased]
### Fixed

- Agents and the assistant found nothing in the knowledge base for Hebrew questions the documents answered: the `knowledge.search` tool cut results below a similarity of 0.2, while Amazon Titan embeddings score relevant Hebrew passages lower (0.17 measured on the live demo). The cut is now 0.1.
- The two delegation tools were shown in English in the Hebrew interface.
- The tab rows of Deals, Settings and Automations, the search-and-pick lists and the action menus still showed the chosen or focused item as white on a near-white card; they now use the area's colour like the other controls.
- Selected states were hard to see on the tinted cards: the chosen option of a segmented control, a tab row and a dropdown list is now filled with the area's colour (hover is the soft shade), secondary buttons, dropdown lists and segmented controls have a visible outline, and a switch that is off is darker.
- Dark theme: the hint text and icon tiles of the dashboard's stat cards kept their light-theme colours and were hard to read.
- Assistant chat: message bubbles follow the direction of their own text (an English reply inside the Hebrew layout no longer has its punctuation flipped), and the message box no longer shows a second focus ring inside its frame.
- Bedrock replies no longer show the model's inline `<thinking>` text (Amazon Nova writes its reasoning into the answer); it is removed in the provider, for streamed and non-streamed replies.
- The assistant page treated an Amazon Bedrock provider as "AI not configured" because it has no API key; found on the first live deployment.

### Added

- First-visit guide: the first time a person opens a screen, a short card says what the screen is for and gives three steps to start, for all 19 screens in English and Hebrew. "Got it" hides it for that screen, "Don't show guides" hides all, and the help button in the top bar shows it again. Remembered in the browser only.
- Hover motion in the rail and the top bar: the icon slides forward and grows slightly, the link gets a halo in its area's colour, and the area's tile lifts. Off when the user prefers reduced motion.
- Top bar on a dark gradient (the rail's colour through deep blue and violet to deep magenta), with a larger brand mark that animates gently (off when the user prefers reduced motion).
- One background for the whole product: a fixed gradient of the five area colours, the same in every area. What changes with the area is the tint of the cards (stat cards keep their own colour). Supersedes the per-area page background.
- The side rail lists every area with its screens (name and icon for each), on one dark colour in both themes, so the rail does not compete with the page gradient; the current screen is marked with its area's colour. On wide screens the tab row above the page is no longer shown, so each screen appears once; on phones the bottom bar and the tab row are unchanged.
- Areas rail with names: on wide screens every area shows its name beside its icon, and the rail has its own deeper shade of the current area's colour. The page background has a clear tint of the area's colour at every point instead of fading to plain white, so the white cards stand out. Contrast of text on both is checked by `scripts/check-contrast.mjs` (162 pairs).
- Denser layout: less padding in cards, table rows, stat cards, page headers and around the page, and a wider content column.
- Navigation by areas (version 2 of the interface). The dark sidebar is replaced by six areas - Today, Customers, Sales, AI, Operations, Organization - shown as a light rail on wide screens and as a bar at the bottom of the screen on phones. The screens of the current area are tabs above the page, and every screen belongs to exactly one area (tasks and reports are in Today; billing, AI settings and the profile stay tabs of Settings and are no longer listed twice). No route changed.
- Each area has one colour that is also its accent: the primary button, links, focus rings, selected states, and the dialogs and toasts opened from that area. The page background is almost white with a hint of the area's colour.
- The assistant is one click away from every screen through the bar at the top (it opens the assistant; it does not act from the bar).
- Plain-language screens: agent tools and workflow templates are shown with translated names and descriptions (the API describes them in English); a template's requirements read "an agent" / "an owner" instead of field names.
- Integrations are split into "Available now" and "Not available yet"; the implementation notes ("configuration only in this release", "nothing is simulated") are gone.
- Billing: usage reads "1 of 25"; higher plans show what they include in total instead of differences; while no payment provider exists the action on a plan is "Contact sales" rather than an Upgrade button that could only fail; the environment-variable name is no longer shown in the cost note.
- Contacts and companies lists use `FilterBar`.
- UX foundations (styling only): measured colour contrast instead of judging by eye - `node scripts/check-contrast.mjs` checks 106 text/background pairs of the design tokens in the light and dark themes and now passes. Fixed on the way: helper text (`fg-subtle`) in the light theme, the outline of form controls (new `border-control` token, at least 3:1), and the label of the danger button in the dark theme (new `danger-fg` token). Helper text is 13px (was 12px) and the smallest label 12px (was 11px).
- `FilterBar` and `FormSection` in the design system. The leads list uses `FilterBar`: on a phone only the search and a "Filters (n)" button stay above the list.
- Social sign-in and sign-up: "Continue with Google / Microsoft / Facebook / GitHub" on the login and register pages. A provider is offered only when its `OAUTH_<PROVIDER>_CLIENT_ID` and `_CLIENT_SECRET` are set. An address the provider verified (Google, GitHub) signs in without a second verification and may be linked to an existing account; Microsoft and Facebook addresses are treated as unverified, so they never link to an existing account and a new account still has to confirm its email. Tested with stubbed provider responses only - no provider has been called live yet.
- Amazon SES email driver (`EMAIL_DRIVER=ses`): sends through the SES API with the server's AWS identity, so no SMTP password is stored.
- UI polish: pill-style tab bars, tone-coloured empty states and table rows, softer focus ring on inputs.
- Visual redesign (styling only, no behaviour change): per-area colour tones, dark navigation rail with coloured icon tiles, area icon beside page titles, coloured stat tiles and deal-board columns, larger radii, press/hover/enter motion, coloured toast icons, and rounded option lists for native selects in browsers that support customizable selects.

- Email-verification enforcement (`REQUIRE_EMAIL_VERIFICATION`) with `POST /auth/resend-verification` and a verification gate in the web app.
- Per-account login lockout (`LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCKOUT_WINDOW`) and a Content-Security-Policy for the web app.
- Workers re-check the AI budget hard stop before queued agent runs, workflow agent steps, evaluation cases and embeddings.
- Hebrew emails with right-to-left layout; the web app sends its UI language to the API.
- Agent evaluation datasets: `/evaluations` API, `evaluation_run` worker task, Evaluations pages (migration `20261111234833_evaluations`).
- CI builds the three Docker images, applies migrations from the API image and smoke-tests the running containers.

### Documentation

- `docs/operations/aws-growth-guide.he.html`: staged Hebrew guide (preparation, demo on a single server, pilot, launch on the managed stack, scale) with cost estimates per stage.

### Fixed (deployment)

- The ECS migrate task pointed at files the API image did not contain; the image now ships a migration bundle in `/app/migrate`.
- The API syncs the permission catalog on start; a fresh environment no longer needs a seed step.
- Single-host deployment (`docker-compose.prod.yml`): migrate service fixed, Caddy receives `APP_DOMAIN`, shared uploads volume, `IMAGE_REPOSITORY` (lowercase); CI now brings this stack up and checks it.

### Fixed

- CI: packages are built before the database seed; API and workers integration suites run one after the other (they share a database); the repository is Prettier-clean and load-test result files are ignored by Prettier.
- Dependencies: zod 4.6.7 (was 3.25), multer >= 2.5.0, postcss >= 8.5.23 — `pnpm audit --prod` is clean. Validation issue codes in `400 VALIDATION_ERROR` details follow zod 4 (`invalid_format` instead of `invalid_string`).

### Documentation

- Product documents (vision, functional specification, user journeys, feature matrix), design documents (design system, screen specifications), architecture documents (system overview with C4 diagrams, tenant isolation) and development documents (gap analysis, implementation plan) written from the code, with an explicit status per feature (verified / not live-tested / partial / not implemented / externally blocked).
- README, setup, roadmap and task-status corrected: stale "Not Started" rows for the AI, knowledge, automation and commercial areas replaced by their verified state; stale "placeholder routes" claim removed; known `.env.example` inconsistencies recorded.

### Known issues (found while documenting, not fixed in this change)

- `.env.example` lists `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `N8N_WEBHOOK_URL`, `N8N_API_KEY`, but no code reads them.
- Email verification is not enforced and has no resend endpoint; stored organization business hours and branding colour are not applied anywhere.
- Plan limits `agents` and `automations` are reported but not enforced; workers do not re-check the AI budget.
- Organization setting `ai.defaultProvider` accepts only `anthropic` or `openai`.
- The landing page describes customer-channel capabilities that are not implemented.

### Added

- Phase 7: tasks with reminders, companies, pipelines and deals (Kanban, conversion report), CSV import/export, create_task workflow step, AI tools for tasks and deals; Hebrew/RTL localization; tasks/deals/companies/imports UI.
- Priority 6: independent security review with 7 fixes, load-test harness with measured results and query optimizations, product/design/architecture documentation, Hebrew AWS setup guide.
- AWS (unverified, nothing deployed): Amazon Bedrock AI provider adapter (`bedrock`; Converse/ConverseStream/tool use/Titan+Cohere embeddings; IAM credential chain; gated by `AI_BEDROCK_ENABLED`) with a mocked-client test suite, `AiProviderConfig.region` migration, provider-dialog support; AWS CDK v2 app in `infra/cdk` (VPC, ECS Fargate api/web/workers, ALB, RDS PostgreSQL, ElastiCache Redis, S3, Secrets Manager, WAF, Backup, CloudWatch, Budgets; cdk-nag); `infra.yml` validate-only workflow and a disabled, approval-gated `deploy-aws.yml` stub; AWS architecture, capability matrix, AgentCore decision, cost model, runbooks, SLOs, backup/recovery and a step-by-step AWS setup guide.
- Priority 4 web: knowledge bases with retrieval test, automation editor/templates/executions/webhooks, integrations.
- Priority 5 backend: analytics reports with CSV export, entitlements overview, plans, upgrade options, AI budgets with admission control and alerts.
- Priority 4 backend: knowledge bases with document ingestion (extract, chunk, embed, pgvector search) and the `knowledge.search` agent tool; workflows with a runner and scheduler; inbound/outbound webhooks (HMAC, SSRF guard, retries); integration framework (REST, n8n); domain events.
- Priority 3 AI platform: provider/usage/prompt/tool APIs, streaming AI assistant, agent builder with sync/async executions and inspector, Settings → AI, worker consumer, conversation summaries; mock-provider e2e journey.
- Priority 2 core business: contacts, leads (notes, activities, assignment, conversion), conversations & messages, notifications (in-app + preferences), live dashboard analytics — API modules, web pages (leads/contacts/conversations/dashboard), new UI primitives (Combobox, TagInput, SegmentedControl, Timeline, AreaChart, AutosizeTextarea) and e2e CRM journey.
- AI engine package (`@hilatech/ai-engine`): Anthropic/OpenAI/Mock adapters, context builder, permission-gated tool executor, agent runner with budgets and delegation, pgvector knowledge retrieval helpers; AI-platform database migration.
- Priority 1 foundation: NestJS API (auth with refresh rotation, organizations, members, roles/permissions, invitations, audit, billing readiness, analytics counts), BullMQ workers app, Next.js web app with design-system package; unit, integration, security and e2e suites.
- Monorepo skeleton (pnpm + Turborepo), shared config, contracts, shared utilities, types.
- Prisma schema for identity, tenancy, governance, CRM and notifications; seed for permission catalog and demo data.
- Docker Compose (Postgres + pgvector, Redis, app profile), Dockerfiles, GitHub Actions CI.
- Architecture, database, security and API documentation.
