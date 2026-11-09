/**
 * Per-environment configuration. EVERYTHING sized here is a *starting point*, not a load-tested capacity plan:
 * dev is deliberately small, prod is a conservative baseline that you must revisit with real traffic and the
 * AWS Pricing Calculator. No dollar amounts are encoded except the budget limits, which are YOUR tolerance
 * (placeholders - change them in `budget.monthlyLimitUsd` before deploying).
 */
export type EnvName = 'dev' | 'staging' | 'prod';

export interface ServiceSizing {
  /** Fargate CPU units (256 = 0.25 vCPU). Must be a valid Fargate cpu/memory pair. */
  cpu: number;
  memoryMiB: number;
  minTasks: number;
  maxTasks: number;
  /** Target average CPU utilisation (%) for target-tracking scaling. */
  targetCpuPercent: number;
}

export interface EnvConfig {
  name: EnvName;
  /** Number of AZs for the VPC (2 everywhere; the task spec asks for 2 AZ). */
  azCount: number;
  /** NAT gateways: 1 in dev/staging (single point of failure for egress, cheaper), one per AZ in prod. */
  natGateways: number;
  /** Interface VPC endpoints (ECR, Logs, Secrets Manager, Bedrock Runtime): hourly cost, but keep traffic off NAT. */
  interfaceEndpoints: boolean;
  flowLogs: boolean;
  database: {
    instanceClass: string; // e.g. 't4g.micro'
    allocatedStorageGiB: number;
    maxAllocatedStorageGiB: number;
    multiAz: boolean;
    backupRetentionDays: number;
    deletionProtection: boolean;
    /** true = RETAIN/snapshot on stack delete; false = destroy (dev teardown). */
    retainOnDelete: boolean;
    performanceInsights: boolean;
  };
  redis: {
    /** 'elasticache' creates a managed node; 'external' expects you to store a REDIS_URL secret (cost toggle). */
    kind: 'elasticache' | 'external';
    nodeType: string; // e.g. 'cache.t4g.micro'
    replicas: number;
  };
  storage: { retainOnDelete: boolean; noncurrentVersionExpiryDays: number };
  services: { api: ServiceSizing; web: ServiceSizing; workers: ServiceSizing };
  cpuArchitecture: 'X86_64' | 'ARM64';
  logRetentionDays: number;
  waf: { enabled: boolean; rateLimitPer5Min: number };
  backup: { enabled: boolean; dailyRetentionDays: number; monthlyRetentionDays?: number };
  budget: { enabled: boolean; monthlyLimitUsd: number };
  bedrock: {
    /** Sets AI_BEDROCK_ENABLED for the API. Task roles always get the scoped IAM policy below when true. */
    enabled: boolean;
    /** Foundation-model ids (and inference-profile ids) the task roles may invoke. No wildcard-all by default. */
    allowedModelIds: string[];
    /** Regions whose foundation-model ARNs are allowed (cross-region inference profiles route to several). */
    allowedRegions: string[];
  };
  alb: { deletionProtection: boolean; idleTimeoutSeconds: number };
}

const bedrockModelIds = [
  // UNVERIFIED ids (see docs/architecture/aws-capability-matrix.md). Replace with the models you actually enabled.
  'amazon.nova-micro-v1:0',
  'amazon.nova-lite-v1:0',
  'amazon.nova-pro-v1:0',
  'amazon.titan-embed-text-v2:0',
  'cohere.embed-english-v3',
  'cohere.embed-multilingual-v3',
  'anthropic.claude-sonnet-4-5-20250929-v1:0',
  'anthropic.claude-haiku-4-5-20251001-v1:0',
  // Global cross-region inference profiles (the ids the app's model registry lists for Claude on Bedrock).
  'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'global.anthropic.claude-haiku-4-5-20251001-v1:0',
];

export const ENV_CONFIGS: Record<EnvName, EnvConfig> = {
  dev: {
    name: 'dev',
    azCount: 2,
    natGateways: 1,
    interfaceEndpoints: false,
    flowLogs: false,
    database: {
      instanceClass: 't4g.micro',
      allocatedStorageGiB: 20,
      maxAllocatedStorageGiB: 50,
      multiAz: false,
      backupRetentionDays: 1,
      deletionProtection: false,
      retainOnDelete: false,
      performanceInsights: false,
    },
    redis: { kind: 'elasticache', nodeType: 'cache.t4g.micro', replicas: 0 },
    storage: { retainOnDelete: false, noncurrentVersionExpiryDays: 7 },
    services: {
      api: { cpu: 256, memoryMiB: 512, minTasks: 1, maxTasks: 2, targetCpuPercent: 65 },
      web: { cpu: 256, memoryMiB: 512, minTasks: 1, maxTasks: 2, targetCpuPercent: 65 },
      workers: { cpu: 256, memoryMiB: 512, minTasks: 1, maxTasks: 2, targetCpuPercent: 65 },
    },
    cpuArchitecture: 'X86_64',
    logRetentionDays: 14,
    waf: { enabled: false, rateLimitPer5Min: 2000 },
    backup: { enabled: false, dailyRetentionDays: 7 },
    budget: { enabled: true, monthlyLimitUsd: 100 },
    bedrock: { enabled: true, allowedModelIds: bedrockModelIds, allowedRegions: ['us-east-1'] },
    alb: { deletionProtection: false, idleTimeoutSeconds: 120 },
  },
  staging: {
    name: 'staging',
    azCount: 2,
    natGateways: 1,
    interfaceEndpoints: false,
    flowLogs: true,
    database: {
      instanceClass: 't4g.small',
      allocatedStorageGiB: 20,
      maxAllocatedStorageGiB: 100,
      multiAz: false,
      backupRetentionDays: 7,
      deletionProtection: true,
      retainOnDelete: true,
      performanceInsights: false,
    },
    redis: { kind: 'elasticache', nodeType: 'cache.t4g.small', replicas: 0 },
    storage: { retainOnDelete: true, noncurrentVersionExpiryDays: 30 },
    services: {
      api: { cpu: 512, memoryMiB: 1024, minTasks: 1, maxTasks: 3, targetCpuPercent: 60 },
      web: { cpu: 256, memoryMiB: 512, minTasks: 1, maxTasks: 3, targetCpuPercent: 60 },
      workers: { cpu: 512, memoryMiB: 1024, minTasks: 1, maxTasks: 3, targetCpuPercent: 60 },
    },
    cpuArchitecture: 'X86_64',
    logRetentionDays: 30,
    waf: { enabled: true, rateLimitPer5Min: 2000 },
    backup: { enabled: true, dailyRetentionDays: 14 },
    budget: { enabled: true, monthlyLimitUsd: 300 },
    bedrock: { enabled: true, allowedModelIds: bedrockModelIds, allowedRegions: ['us-east-1'] },
    alb: { deletionProtection: true, idleTimeoutSeconds: 120 },
  },
  prod: {
    name: 'prod',
    azCount: 2,
    natGateways: 2,
    interfaceEndpoints: true,
    flowLogs: true,
    database: {
      instanceClass: 't4g.medium',
      allocatedStorageGiB: 50,
      maxAllocatedStorageGiB: 500,
      multiAz: true,
      backupRetentionDays: 14,
      deletionProtection: true,
      retainOnDelete: true,
      performanceInsights: true,
    },
    redis: { kind: 'elasticache', nodeType: 'cache.t4g.small', replicas: 1 },
    storage: { retainOnDelete: true, noncurrentVersionExpiryDays: 90 },
    services: {
      api: { cpu: 1024, memoryMiB: 2048, minTasks: 2, maxTasks: 10, targetCpuPercent: 55 },
      web: { cpu: 512, memoryMiB: 1024, minTasks: 2, maxTasks: 10, targetCpuPercent: 55 },
      workers: { cpu: 1024, memoryMiB: 2048, minTasks: 2, maxTasks: 10, targetCpuPercent: 55 },
    },
    cpuArchitecture: 'X86_64',
    logRetentionDays: 90,
    waf: { enabled: true, rateLimitPer5Min: 2000 },
    backup: { enabled: true, dailyRetentionDays: 35, monthlyRetentionDays: 365 },
    budget: { enabled: true, monthlyLimitUsd: 1000 },
    bedrock: { enabled: true, allowedModelIds: bedrockModelIds, allowedRegions: ['us-east-1'] },
    alb: { deletionProtection: true, idleTimeoutSeconds: 120 },
  },
};

export function resolveEnvName(value: unknown): EnvName {
  if (value === 'dev' || value === 'staging' || value === 'prod') return value;
  throw new Error(`Unknown environment "${String(value)}": use -c env=dev|staging|prod`);
}
