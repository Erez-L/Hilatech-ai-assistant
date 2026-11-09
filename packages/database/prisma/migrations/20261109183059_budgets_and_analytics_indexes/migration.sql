-- CreateEnum
CREATE TYPE "BudgetAlertScope" AS ENUM ('budget_tokens', 'budget_cost', 'plan_tokens');

-- CreateEnum
CREATE TYPE "BudgetAlertKind" AS ENUM ('warning', 'exceeded');

-- CreateTable
CREATE TABLE "OrganizationBudget" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "monthlyTokenBudget" BIGINT,
    "monthlyCostBudgetUsd" DECIMAL(14,4),
    "warnThresholdPct" INTEGER NOT NULL DEFAULT 80,
    "hardStopEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetAlert" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "scope" "BudgetAlertScope" NOT NULL,
    "kind" "BudgetAlertKind" NOT NULL,
    "used" DECIMAL(20,6) NOT NULL,
    "limit" DECIMAL(20,6) NOT NULL,
    "thresholdPct" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationBudget_organizationId_key" ON "OrganizationBudget"("organizationId");

-- CreateIndex
CREATE INDEX "BudgetAlert_organizationId_createdAt_idx" ON "BudgetAlert"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BudgetAlert_organizationId_periodStart_scope_kind_key" ON "BudgetAlert"("organizationId", "periodStart", "scope", "kind");

-- CreateIndex
CREATE INDEX "WebhookDelivery_organizationId_createdAt_idx" ON "WebhookDelivery"("organizationId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "OrganizationBudget" ADD CONSTRAINT "OrganizationBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetAlert" ADD CONSTRAINT "BudgetAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
