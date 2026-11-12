-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "EvaluationResultStatus" AS ENUM ('passed', 'failed', 'error');

-- CreateTable
CREATE TABLE "EvaluationDataset" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCase" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "input" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'queued',
    "totalCases" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errored" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "triggeredByUserId" UUID,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationResult" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "caseId" UUID,
    "caseName" VARCHAR(160) NOT NULL,
    "input" TEXT NOT NULL,
    "status" "EvaluationResultStatus" NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "checks" JSONB NOT NULL,
    "executionId" UUID,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvaluationDataset_organizationId_createdAt_idx" ON "EvaluationDataset"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "EvaluationCase_organizationId_datasetId_position_idx" ON "EvaluationCase"("organizationId", "datasetId", "position");

-- CreateIndex
CREATE INDEX "EvaluationRun_organizationId_createdAt_idx" ON "EvaluationRun"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "EvaluationRun_organizationId_datasetId_createdAt_idx" ON "EvaluationRun"("organizationId", "datasetId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "EvaluationResult_organizationId_runId_idx" ON "EvaluationResult"("organizationId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationResult_runId_caseId_key" ON "EvaluationResult"("runId", "caseId");

-- AddForeignKey
ALTER TABLE "EvaluationDataset" ADD CONSTRAINT "EvaluationDataset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationCase" ADD CONSTRAINT "EvaluationCase_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "EvaluationDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "EvaluationDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "EvaluationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
