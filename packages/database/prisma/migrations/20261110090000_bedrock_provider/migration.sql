-- Amazon Bedrock provider kind (IAM / AWS credential chain, no stored API key) and its optional AWS region.
-- ADD VALUE cannot run inside a transaction block together with statements that use the new value; none do here.
ALTER TYPE "AiProviderKind" ADD VALUE 'bedrock';

-- AlterTable
ALTER TABLE "AiProviderConfig" ADD COLUMN "region" VARCHAR(40);
