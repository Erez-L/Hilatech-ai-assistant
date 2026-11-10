-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('human', 'ai', 'automation');

-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('open', 'won', 'lost');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('open', 'won', 'lost');

-- CreateEnum
CREATE TYPE "ImportEntity" AS ENUM ('contacts', 'leads', 'companies', 'deals');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('uploaded', 'validated', 'queued', 'running', 'completed', 'failed', 'cancelled');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "companyId" UUID;

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "priority" "TaskPriority" NOT NULL DEFAULT 'medium',
    "dueAt" TIMESTAMP(3),
    "reminderAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assigneeId" UUID,
    "createdById" UUID,
    "source" "TaskSource" NOT NULL DEFAULT 'human',
    "leadId" UUID,
    "contactId" UUID,
    "dealId" UUID,
    "conversationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "domain" VARCHAR(160),
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "order" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "kind" "StageKind" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "value" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "pipelineId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'open',
    "position" INTEGER NOT NULL DEFAULT 0,
    "ownerId" UUID,
    "contactId" UUID,
    "companyId" UUID,
    "expectedCloseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealNote" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealActivity" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "actorId" UUID,
    "type" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealStageChange" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "fromStageId" UUID,
    "toStageId" UUID NOT NULL,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealStageChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "entity" "ImportEntity" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'uploaded',
    "fileName" VARCHAR(255) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" VARCHAR(64),
    "encoding" VARCHAR(32),
    "delimiter" VARCHAR(8),
    "headers" JSONB NOT NULL DEFAULT '[]',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB,
    "duplicateStrategy" VARCHAR(16) NOT NULL DEFAULT 'skip',
    "validation" JSONB,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdById" UUID,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_organizationId_status_dueAt_idx" ON "Task"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_organizationId_assigneeId_status_idx" ON "Task"("organizationId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "Task_organizationId_createdAt_idx" ON "Task"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Task_reminderAt_idx" ON "Task"("reminderAt");

-- CreateIndex
CREATE INDEX "Task_leadId_idx" ON "Task"("leadId");

-- CreateIndex
CREATE INDEX "Task_contactId_idx" ON "Task"("contactId");

-- CreateIndex
CREATE INDEX "Task_dealId_idx" ON "Task"("dealId");

-- CreateIndex
CREATE INDEX "Task_conversationId_idx" ON "Task"("conversationId");

-- CreateIndex
CREATE INDEX "Company_organizationId_name_idx" ON "Company"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Company_organizationId_createdAt_idx" ON "Company"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Company_ownerId_idx" ON "Company"("ownerId");

-- CreateIndex
CREATE INDEX "Pipeline_organizationId_isDefault_idx" ON "Pipeline"("organizationId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_organizationId_name_key" ON "Pipeline"("organizationId", "name");

-- CreateIndex
CREATE INDEX "PipelineStage_organizationId_idx" ON "PipelineStage"("organizationId");

-- CreateIndex
CREATE INDEX "PipelineStage_pipelineId_order_idx" ON "PipelineStage"("pipelineId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_pipelineId_name_key" ON "PipelineStage"("pipelineId", "name");

-- CreateIndex
CREATE INDEX "Deal_organizationId_pipelineId_stageId_position_idx" ON "Deal"("organizationId", "pipelineId", "stageId", "position");

-- CreateIndex
CREATE INDEX "Deal_organizationId_status_idx" ON "Deal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Deal_organizationId_ownerId_idx" ON "Deal"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "Deal_organizationId_createdAt_idx" ON "Deal"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Deal_contactId_idx" ON "Deal"("contactId");

-- CreateIndex
CREATE INDEX "Deal_companyId_idx" ON "Deal"("companyId");

-- CreateIndex
CREATE INDEX "Deal_stageId_idx" ON "Deal"("stageId");

-- CreateIndex
CREATE INDEX "DealNote_dealId_createdAt_idx" ON "DealNote"("dealId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DealNote_organizationId_idx" ON "DealNote"("organizationId");

-- CreateIndex
CREATE INDEX "DealActivity_dealId_createdAt_idx" ON "DealActivity"("dealId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DealActivity_organizationId_idx" ON "DealActivity"("organizationId");

-- CreateIndex
CREATE INDEX "DealStageChange_dealId_createdAt_idx" ON "DealStageChange"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "DealStageChange_organizationId_pipelineId_toStageId_idx" ON "DealStageChange"("organizationId", "pipelineId", "toStageId");

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_createdAt_idx" ON "ImportJob"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_status_idx" ON "ImportJob"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealNote" ADD CONSTRAINT "DealNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealNote" ADD CONSTRAINT "DealNote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealNote" ADD CONSTRAINT "DealNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealActivity" ADD CONSTRAINT "DealActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealActivity" ADD CONSTRAINT "DealActivity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStageChange" ADD CONSTRAINT "DealStageChange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStageChange" ADD CONSTRAINT "DealStageChange_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data backfill (hand-written, idempotent)
-- ---------------------------------------------------------------------------

-- 1. Permission catalog: new keys.
INSERT INTO "Permission" ("key", "group") VALUES
  ('tasks:read', 'tasks'), ('tasks:create', 'tasks'), ('tasks:update', 'tasks'),
  ('tasks:delete', 'tasks'), ('tasks:assign', 'tasks'),
  ('companies:read', 'companies'), ('companies:create', 'companies'),
  ('companies:update', 'companies'), ('companies:delete', 'companies'),
  ('deals:read', 'deals'), ('deals:create', 'deals'), ('deals:update', 'deals'), ('deals:delete', 'deals'),
  ('pipelines:manage', 'pipelines'),
  ('data:import', 'data'), ('data:export', 'data')
ON CONFLICT ("key") DO NOTHING;

-- 2. System roles of existing organizations receive the new keys (custom roles are left untouched).
UPDATE "Role" r
SET "permissions" = ARRAY(
  SELECT DISTINCT p FROM unnest(r."permissions" || ARRAY[
    'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'tasks:assign',
    'companies:read', 'companies:create', 'companies:update', 'companies:delete',
    'deals:read', 'deals:create', 'deals:update', 'deals:delete',
    'pipelines:manage', 'data:import', 'data:export'
  ]) AS p ORDER BY p
)
WHERE r."isSystem" = true AND r."key" IN ('owner', 'admin');

UPDATE "Role" r
SET "permissions" = ARRAY(
  SELECT DISTINCT p FROM unnest(r."permissions" || ARRAY[
    'tasks:read', 'tasks:create', 'tasks:update',
    'companies:read', 'companies:create', 'companies:update',
    'deals:read', 'deals:create', 'deals:update'
  ]) AS p ORDER BY p
)
WHERE r."isSystem" = true AND r."key" = 'member';

-- 3. Default sales pipeline (Lead, Qualified, Proposal, Negotiation, Won, Lost) for every organization without one.
INSERT INTO "Pipeline" ("id", "organizationId", "name", "isDefault", "updatedAt")
SELECT gen_random_uuid(), o."id", 'Sales', true, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Pipeline" p WHERE p."organizationId" = o."id");

INSERT INTO "PipelineStage" ("id", "organizationId", "pipelineId", "name", "order", "probability", "kind", "updatedAt")
SELECT gen_random_uuid(), p."organizationId", p."id", s."name", s."order", s."probability", s."kind"::"StageKind", CURRENT_TIMESTAMP
FROM "Pipeline" p
CROSS JOIN (VALUES
  ('Lead', 0, 10, 'open'),
  ('Qualified', 1, 25, 'open'),
  ('Proposal', 2, 50, 'open'),
  ('Negotiation', 3, 75, 'open'),
  ('Won', 4, 100, 'won'),
  ('Lost', 5, 0, 'lost')
) AS s("name", "order", "probability", "kind")
WHERE p."isDefault" = true AND p."name" = 'Sales'
  AND NOT EXISTS (SELECT 1 FROM "PipelineStage" x WHERE x."pipelineId" = p."id");
