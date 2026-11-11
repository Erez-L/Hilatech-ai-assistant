# Database

PostgreSQL 16 with the `vector` (pgvector) and `citext` extensions. Schema lives in
`packages/database/prisma/schema.prisma`; migrations in `packages/database/prisma/migrations`.

## Entity groups

| Group                   | Entities                                                                                              | Notes                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                | `User`, `RefreshToken`, `PasswordResetToken`, `EmailVerificationToken`                                | Tokens stored hashed; refresh tokens grouped by `familyId`                                                                                                                                                                        |
| Tenancy                 | `Organization`, `OrganizationMember`, `Role`, `Permission`, `Invitation`                              | Members unique per (organization, user); roles unique per (organization, key)                                                                                                                                                     |
| Governance              | `AuditLog`, `Subscription`, `UsageRecord`                                                             | Audit indexed by (organization, createdAt desc)                                                                                                                                                                                   |
| CRM                     | `Contact`, `Lead`, `LeadNote`, `LeadActivity`, `Conversation`, `Message`                              | Soft delete on Contact/Lead                                                                                                                                                                                                       |
| Notifications           | `Notification`                                                                                        | Preferences stored in `User.preferences` JSON                                                                                                                                                                                     |
| AI (Priority 3)         | `AiProviderConfig`, `Agent`, `AgentExecution`, `AiUsageLog`, prompt templates                         | Added by later migrations                                                                                                                                                                                                         |
| Knowledge (Priority 4)  | `KnowledgeBase`, `Document`, `DocumentChunk` (vector)                                                 | pgvector columns via `Unsupported("vector(…)")`                                                                                                                                                                                   |
| Automation (Priority 4) | `Workflow`, `WorkflowExecution`, `WebhookEndpoint`, `Integration`                                     |                                                                                                                                                                                                                                   |
| Sales (Phase 7)         | `Task`, `Company`, `Pipeline`, `PipelineStage`, `Deal`, `DealNote`, `DealActivity`, `DealStageChange` | Hard delete. Deals keep contiguous Kanban `position` per stage; `Deal.status` follows the stage `kind`; `DealStageChange` feeds the conversion report. `Contact.companyId` links a Company (the free-text `company` column stays) |
| Data exchange (Phase 7) | `ImportJob`                                                                                           | CSV file lives in the storage driver (`storageKey`); row results kept as counters + a capped JSON report                                                                                                                          |

## Rules

- Every organization-owned table: `organizationId uuid NOT NULL` + index + FK with cascade.
- UUID primary keys, `createdAt`/`updatedAt` on mutable rows.
- Soft deletion (`deletedAt`) only on Contact, Lead and Organization.
- No binary documents in Postgres — files go to the storage driver; the database keeps metadata.
- A default `Sales` pipeline (Lead, Qualified, Proposal, Negotiation, Won, Lost) is created with every organization
  (`createDefaultPipeline`, used by the API, the seed and the Phase 7 migration backfill; `ensureDefaultPipeline` heals
  organizations that lack one). Money is never summed across currencies.
- Tasks: `reminderSentAt` is the idempotency marker of the reminder job (cleared when `reminderAt` changes); the
  notification additionally carries `data.idempotencyKey = task-reminder:<taskId>:<reminderAt ms>`.
- Schema changes only through `prisma migrate dev --name <change>`; migrations are committed.

## Local workflow

```bash
pnpm db:generate            # generate the client (packages/database/src/generated)
pnpm db:migrate:dev         # create/apply migrations in development
pnpm db:migrate             # apply committed migrations (CI/prod)
SEED_DEMO=true pnpm db:seed # permission catalog + demo organization
```

If `binaries.prisma.sh` is blocked on your network, `scripts/prisma-wasm-migrate.mjs` runs the same
migrations with the WebAssembly schema engine (see ADR-003b):

```bash
node scripts/prisma-wasm-migrate.mjs create add_agents   # diff live DB → schema, write migration.sql
node scripts/prisma-wasm-migrate.mjs apply               # apply pending migrations
node scripts/prisma-wasm-migrate.mjs status              # history diagnostics
```

Note: Prisma 7 no longer manages extensions from the schema; the init migration creates `citext` and
`vector` explicitly, and the Docker Postgres image (`pgvector/pgvector:pg16`) ships both.
