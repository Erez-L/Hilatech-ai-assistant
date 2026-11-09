import { Validations } from 'aws-cdk-lib';
import type { EnvConfig } from './config';
import type { AppStack } from './stacks/app-stack';
import type { DataStack } from './stacks/data-stack';
import type { NetworkStack } from './stacks/network-stack';
import type { OpsStack } from './stacks/ops-stack';
import type { RegistryStack } from './stacks/registry-stack';

/**
 * cdk-nag (AwsSolutions pack) acknowledgements. Every entry is a deliberate, reasoned exception - this file IS the
 * documented IAM/security self-review companion (see docs/architecture/aws-architecture.md "Security review").
 * Conditional entries only exist for the environments where the exception actually applies, so staging/prod do not
 * silently inherit dev shortcuts.
 */
export interface NagTargets {
  network: NetworkStack;
  registry: RegistryStack;
  data: DataStack;
  app: AppStack;
  ops: OpsStack;
  config: EnvConfig;
}

export function applyNagAcknowledgements({ network, data, app, config }: NagTargets): void {
  const ack = (scope: Parameters<typeof Validations.of>[0], id: string, reason: string) =>
    Validations.of(scope).acknowledge({ id, reason });
  const dev = config.name === 'dev';

  // ---- Network ---------------------------------------------------------------------------------------------
  ack(
    network.albSg,
    'AwsSolutions-EC23',
    'Public internet-facing ALB: 80/443 from anywhere is the intent. WAF + TLS in front of private tasks.',
  );
  if (!config.flowLogs)
    ack(
      network,
      'AwsSolutions-VPC7',
      'dev: VPC flow logs disabled to save cost; enabled in staging/prod.',
    );

  // ---- Data ------------------------------------------------------------------------------------------------
  for (const [secret, why] of [
    [
      data.jwtAccessSecret,
      'JWT signing secret: rotating it logs every user out; rotation is a manual, planned runbook step.',
    ],
    [
      data.jwtRefreshSecret,
      'JWT refresh secret: rotating it invalidates all sessions; manual runbook step.',
    ],
    [
      data.credentialsKeySecret,
      'Encryption key for stored org AI credentials: rotation requires re-encrypting data (no automated path yet).',
    ],
    [
      data.databaseUrlSecret,
      'Derived from the DB password at deploy time; automated rotation would desync it. Rotation needs app-side secret fetch (backlog).',
    ],
    [
      data.dbSecret,
      'Automated Lambda rotation would invalidate the derived DATABASE_URL secret; manual rotation runbook until the app reads the secret directly (backlog).',
    ],
    [
      data.redisUrlSecret,
      'Derived from the Redis AUTH token / externally managed value; rotate manually per runbook.',
    ],
  ] as const) {
    ack(secret, 'AwsSolutions-SMG4', why);
  }
  if (data.redis) {
    ack(
      data.redis,
      'AwsSolutions-AEC5',
      'Default Redis port 6379 is reachable only from the api/workers security groups in isolated subnets.',
    );
    if (config.redis.replicas === 0)
      ack(
        data.redis,
        'AwsSolutions-AEC4',
        `${config.name}: single-node Redis (no replica) to save cost; BullMQ jobs are re-creatable.`,
      );
    const authSecret = data.node.tryFindChild('RedisAuth');
    if (authSecret)
      ack(
        authSecret,
        'AwsSolutions-SMG4',
        'AUTH token is shared by ElastiCache and the REDIS_URL secret; rotate manually per runbook.',
      );
  }
  ack(
    data.db,
    'AwsSolutions-RDS11',
    'Default PostgreSQL port: the instance is in isolated subnets, reachable only from app security groups. Port obscurity adds nothing.',
  );
  if (!config.database.multiAz)
    ack(
      data.db,
      'AwsSolutions-RDS3',
      `${config.name}: single-AZ database to save cost (RTO = restore time, see docs/operations/backup-recovery.md).`,
    );
  if (!config.database.deletionProtection)
    ack(
      data.db,
      'AwsSolutions-RDS10',
      'dev: deletion protection off so the environment can be torn down with cdk destroy.',
    );
  if (!data.accessLogsBucket)
    ack(
      data.documentsBucket,
      'AwsSolutions-S1',
      'dev: S3 server access logging disabled (cost/noise). Staging/prod log to the access-logs bucket.',
    );
  if (data.accessLogsBucket)
    ack(data.accessLogsBucket, 'AwsSolutions-S1', 'This IS the access-logs destination bucket.');
  const backupRole = data.node.tryFindChild('BackupRole');
  if (backupRole) {
    for (const policy of [
      'service-role/AWSBackupServiceRolePolicyForBackup',
      'service-role/AWSBackupServiceRolePolicyForRestores',
      'AWSBackupServiceRolePolicyForS3Backup',
      'AWSBackupServiceRolePolicyForS3Restore',
    ]) {
      ack(
        backupRole,
        `AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/${policy}]`,
        'AWS Backup requires the AWS-managed AWSBackupServiceRolePolicy* policies (no customer-managed equivalent is documented).',
      );
    }
  }

  // ---- App ---------------------------------------------------------------------------------------------------
  if (dev)
    ack(
      app.alb,
      'AwsSolutions-ELB2',
      'dev: ALB access logs disabled (cost). Staging/prod log to the access-logs bucket.',
    );
  if (config.name !== 'prod')
    ack(
      app.cluster,
      'AwsSolutions-ECS4',
      `${config.name}: Container Insights disabled to save cost; enabled in prod.`,
    );

  for (const name of ['api', 'web', 'workers', 'migrate'] as const) {
    ack(
      app.node.findChild(`${name}Task`),
      'AwsSolutions-ECS2',
      'Environment variables hold NON-secret configuration only (URLs, bucket names, flags). Secrets are injected from Secrets Manager.',
    );
    ack(
      app.node.findChild(`${name}Task`).node.findChild('ExecutionRole'),
      'AwsSolutions-IAM5[Resource::*]',
      'ecr:GetAuthorizationToken does not support resource-level permissions (Resource * is required by AWS). Log-group and secret access are scoped by ARN.',
    );
  }
  for (const name of ['api', 'workers'] as const) {
    ack(
      app.taskRoles[name],
      `AwsSolutions-IAM5[Resource::${data.stackName}:ExportsOutputFnGetAttDocuments7E5B2978Arn159F38C5/*]`,
      'Object-level S3 actions need <bucket>/* (one specific bucket, no bucket-level wildcards).',
    );
  }
  const globalIds = config.bedrock.allowedModelIds.filter((id) => id.startsWith('global.'));
  if (config.bedrock.enabled) {
    for (const name of ['api', 'workers'] as const) {
      for (const id of globalIds) {
        ack(
          app.taskRoles[name],
          `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:bedrock:*::foundation-model/${id.replace(/^global\./, '')}]`,
          "Global Bedrock inference profiles route to any commercial region, so the underlying foundation-model ARN has a region wildcard; it is constrained by the bedrock:InferenceProfileArn condition to this account's global profile for this one model.",
        );
      }
    }
  }
  if (config.name !== 'prod') {
    for (const name of ['api', 'web', 'workers'] as const) {
      ack(
        app.taskRoles[name],
        'AwsSolutions-IAM5[Resource::*]',
        `${config.name}: ECS Exec (debugging) adds ssmmessages:* on Resource *, which AWS requires. ECS Exec is disabled in prod.`,
      );
    }
  }
}
