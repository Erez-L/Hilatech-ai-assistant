-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('anthropic', 'openai', 'mock');

-- CreateEnum
CREATE TYPE "AiHealthStatus" AS ENUM ('unknown', 'ok', 'error');

-- CreateEnum
CREATE TYPE "AiOperation" AS ENUM ('generate', 'stream', 'structured', 'embed');

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('success', 'error', 'timeout', 'cancelled');

-- CreateEnum
CREATE TYPE "AssistantRole" AS ENUM ('user', 'assistant', 'system', 'tool');

-- CreateEnum
CREATE TYPE "AgentExecutionStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentTrigger" AS ENUM ('manual', 'api', 'automation', 'agent', 'schedule');

-- CreateEnum
CREATE TYPE "AgentStepType" AS ENUM ('llm_call', 'tool_call', 'delegation', 'final', 'error');

-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "provider" "AiProviderKind" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "encryptedApiKey" TEXT,
    "keyLast4" VARCHAR(4),
    "baseUrl" TEXT,
    "defaultModel" VARCHAR(120) NOT NULL,
    "embeddingModel" VARCHAR(120),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastHealthStatus" "AiHealthStatus" NOT NULL DEFAULT 'unknown',
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRequestLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID,
    "agentId" UUID,
    "executionId" UUID,
    "threadId" UUID,
    "provider" "AiProviderKind" NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "operation" "AiOperation" NOT NULL,
    "status" "AiRequestStatus" NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(12,6),
    "errorCode" VARCHAR(60),
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantThread" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(200),
    "providerConfigId" UUID,
    "model" VARCHAR(120),
    "summary" TEXT,
    "summarizedUpTo" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "role" "AssistantRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolCallId" VARCHAR(120),
    "toolName" VARCHAR(120),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "instructions" TEXT NOT NULL,
    "providerConfigId" UUID,
    "model" VARCHAR(120),
    "temperature" DOUBLE PRECISION,
    "maxOutputTokens" INTEGER,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "knowledgeBaseIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "maxSteps" INTEGER NOT NULL DEFAULT 12,
    "maxDurationMs" INTEGER NOT NULL DEFAULT 120000,
    "maxTokens" INTEGER NOT NULL DEFAULT 150000,
    "maxDelegations" INTEGER NOT NULL DEFAULT 3,
    "retryPolicy" JSONB NOT NULL DEFAULT '{"maxAttempts":2,"backoffMs":2000}',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecution" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "parentExecutionId" UUID,
    "rootExecutionId" UUID,
    "triggeredByUserId" UUID,
    "trigger" "AgentTrigger" NOT NULL DEFAULT 'manual',
    "status" "AgentExecutionStatus" NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(12,6),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecutionStep" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "type" "AgentStepType" NOT NULL,
    "name" VARCHAR(120),
    "input" JSONB,
    "output" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'succeeded',
    "error" TEXT,
    "durationMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentExecutionStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProviderConfig_organizationId_isDefault_idx" ON "AiProviderConfig"("organizationId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderConfig_organizationId_name_key" ON "AiProviderConfig"("organizationId", "name");

-- CreateIndex
CREATE INDEX "AiRequestLog_organizationId_createdAt_idx" ON "AiRequestLog"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiRequestLog_organizationId_agentId_idx" ON "AiRequestLog"("organizationId", "agentId");

-- CreateIndex
CREATE INDEX "AiRequestLog_executionId_idx" ON "AiRequestLog"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_organizationId_key_key" ON "PromptTemplate"("organizationId", "key");

-- CreateIndex
CREATE INDEX "AssistantThread_organizationId_userId_lastMessageAt_idx" ON "AssistantThread"("organizationId", "userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "AssistantMessage_threadId_createdAt_idx" ON "AssistantMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Agent_organizationId_isEnabled_idx" ON "Agent"("organizationId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_organizationId_name_key" ON "Agent"("organizationId", "name");

-- CreateIndex
CREATE INDEX "AgentExecution_organizationId_createdAt_idx" ON "AgentExecution"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AgentExecution_organizationId_agentId_status_idx" ON "AgentExecution"("organizationId", "agentId", "status");

-- CreateIndex
CREATE INDEX "AgentExecution_parentExecutionId_idx" ON "AgentExecution"("parentExecutionId");

-- CreateIndex
CREATE INDEX "AgentExecution_rootExecutionId_idx" ON "AgentExecution"("rootExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecutionStep_executionId_index_key" ON "AgentExecutionStep"("executionId", "index");

-- AddForeignKey
ALTER TABLE "AiProviderConfig" ADD CONSTRAINT "AiProviderConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRequestLog" ADD CONSTRAINT "AiRequestLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRequestLog" ADD CONSTRAINT "AiRequestLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRequestLog" ADD CONSTRAINT "AiRequestLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRequestLog" ADD CONSTRAINT "AiRequestLog_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AssistantThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_parentExecutionId_fkey" FOREIGN KEY ("parentExecutionId") REFERENCES "AgentExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecutionStep" ADD CONSTRAINT "AgentExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
