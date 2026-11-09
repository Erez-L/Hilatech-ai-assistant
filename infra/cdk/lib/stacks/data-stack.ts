import * as cdk from 'aws-cdk-lib';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import type { EnvConfig } from '../config';
import type { NetworkStack } from './network-stack';

export interface DataStackProps extends cdk.StackProps {
  config: EnvConfig;
  network: NetworkStack;
}

/**
 * Stateful resources: PostgreSQL (pgvector), Redis (BullMQ + cache), the documents bucket, secrets and the
 * AWS Backup plan. Stateful => separate stack so app deploys can never replace them.
 */
export class DataStack extends cdk.Stack {
  readonly db: rds.DatabaseInstance;
  readonly dbSecret: rds.DatabaseSecret;
  readonly databaseUrlSecret: secretsmanager.Secret;
  readonly jwtAccessSecret: secretsmanager.Secret;
  readonly jwtRefreshSecret: secretsmanager.Secret;
  readonly credentialsKeySecret: secretsmanager.Secret;
  /** REDIS_URL secret: assembled from the ElastiCache endpoint + AUTH token, or a placeholder you set (external). */
  readonly redisUrlSecret: secretsmanager.Secret;
  readonly redis?: elasticache.CfnReplicationGroup;
  readonly documentsBucket: s3.Bucket;
  /** Server-access / ALB access logs. Not created in dev (cost + noise); see nag acknowledgements. */
  readonly accessLogsBucket?: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config, network } = props;
    const removal = config.database.retainOnDelete
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // ---- PostgreSQL ------------------------------------------------------------------------------
    // URL-safe generated password (it is embedded in DATABASE_URL), so punctuation is excluded.
    this.dbSecret = new rds.DatabaseSecret(this, 'DbSecret', {
      username: 'hilatech',
      excludeCharacters: ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
      secretName: `hilatech/${config.name}/db-credentials`,
    });

    const parameterGroup = new rds.ParameterGroup(this, 'DbParams', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      description: 'HilaTech PostgreSQL 16 parameters',
      parameters: { 'rds.force_ssl': '1', log_min_duration_statement: '1000' },
    });

    this.db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: new ec2.InstanceType(config.database.instanceClass),
      credentials: rds.Credentials.fromSecret(this.dbSecret),
      databaseName: 'hilatech',
      vpc: network.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [network.dbSg],
      parameterGroup,
      allocatedStorage: config.database.allocatedStorageGiB,
      maxAllocatedStorage: config.database.maxAllocatedStorageGiB,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: config.database.multiAz,
      publiclyAccessible: false,
      backupRetention: cdk.Duration.days(config.database.backupRetentionDays),
      deletionProtection: config.database.deletionProtection,
      removalPolicy: removal,
      deleteAutomatedBackups: !config.database.retainOnDelete,
      autoMinorVersionUpgrade: true,
      enablePerformanceInsights: config.database.performanceInsights,
      cloudwatchLogsExports: ['postgresql', 'upgrade'],
      iamAuthentication: true,
    });

    // DATABASE_URL secret. NOTE sslmode=no-verify: traffic is TLS-encrypted (rds.force_ssl=1) but the server
    // certificate is not verified because the RDS CA bundle is not in the Node trust store. Hardening path:
    // bundle the RDS global CA in the image and use sslmode=verify-full. (See docs/architecture/aws-architecture.md)
    this.databaseUrlSecret = new secretsmanager.Secret(this, 'DatabaseUrl', {
      secretName: `hilatech/${config.name}/database-url`,
      description: 'DATABASE_URL assembled from the RDS credentials secret',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        cdk.Fn.join('', [
          'postgresql://hilatech:',
          this.dbSecret.secretValueFromJson('password').unsafeUnwrap(),
          '@',
          this.db.dbInstanceEndpointAddress,
          ':',
          this.db.dbInstanceEndpointPort,
          '/hilatech?schema=public&sslmode=no-verify',
        ]),
      ),
    });

    // ---- Redis (BullMQ stays on Redis; see docs for the SQS migration path) -----------------------
    if (config.redis.kind === 'elasticache') {
      const subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
        description: 'HilaTech Redis subnets',
        subnetIds: network.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED })
          .subnetIds,
      });
      // BullMQ requires noeviction: evicting queue keys would silently drop jobs.
      const params = new elasticache.CfnParameterGroup(this, 'RedisParams', {
        cacheParameterGroupFamily: 'redis7',
        description: 'HilaTech Redis (BullMQ: noeviction)',
        properties: { 'maxmemory-policy': 'noeviction' },
      });
      // AUTH token (16-128 printable chars; no @ " /). Alphanumeric generated; also embedded in REDIS_URL.
      const redisAuth = new secretsmanager.Secret(this, 'RedisAuth', {
        secretName: `hilatech/${config.name}/redis-auth-token`,
        description: 'ElastiCache AUTH token (generated)',
        generateSecretString: { passwordLength: 48, excludePunctuation: true },
      });
      const replicas = config.redis.replicas;
      this.redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
        replicationGroupDescription: `hilatech-${config.name} redis`,
        engine: 'redis',
        engineVersion: '7.1',
        cacheNodeType: config.redis.nodeType,
        numCacheClusters: 1 + replicas,
        automaticFailoverEnabled: replicas > 0,
        multiAzEnabled: replicas > 0,
        cacheParameterGroupName: params.ref,
        cacheSubnetGroupName: subnetGroup.ref,
        securityGroupIds: [network.redisSg.securityGroupId],
        atRestEncryptionEnabled: true,
        transitEncryptionEnabled: true,
        authToken: redisAuth.secretValue.unsafeUnwrap(),
        snapshotRetentionLimit: config.name === 'dev' ? 0 : 3,
        autoMinorVersionUpgrade: true,
      });
      this.redis.addResourceDependency(subnetGroup);
      this.redisUrlSecret = new secretsmanager.Secret(this, 'RedisUrl', {
        secretName: `hilatech/${config.name}/redis-url`,
        description: 'REDIS_URL (rediss://, AUTH token) assembled from the ElastiCache endpoint',
        secretStringValue: cdk.SecretValue.unsafePlainText(
          cdk.Fn.join('', [
            'rediss://:',
            redisAuth.secretValue.unsafeUnwrap(),
            '@',
            this.redis.attrPrimaryEndPointAddress,
            ':',
            this.redis.attrPrimaryEndPointPort,
          ]),
        ),
      });
    } else {
      this.redisUrlSecret = new secretsmanager.Secret(this, 'ExternalRedisUrl', {
        secretName: `hilatech/${config.name}/redis-url`,
        description:
          'REDIS_URL for an externally hosted Redis (rediss://user:pass@host:port). SET THIS BEFORE DEPLOYING THE APP STACK.',
        // Placeholder only - never put a real Redis URL (it contains a password) in CDK context or code.
        secretStringValue: cdk.SecretValue.unsafePlainText(
          'rediss://SET-ME-BEFORE-DEPLOYING-APP:6379',
        ),
      });
    }

    // ---- Documents bucket --------------------------------------------------------------------------
    if (config.name !== 'dev') {
      this.accessLogsBucket = new s3.Bucket(this, 'AccessLogs', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED, // ALB access logs only support SSE-S3
        enforceSSL: true,
        objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // required for S3 server access log delivery
        removalPolicy: config.storage.retainOnDelete
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
        lifecycleRules: [
          { id: 'expire-logs', expiration: cdk.Duration.days(config.logRetentionDays) },
        ],
      });
    }
    this.documentsBucket = new s3.Bucket(this, 'Documents', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      ...(this.accessLogsBucket
        ? { serverAccessLogsBucket: this.accessLogsBucket, serverAccessLogsPrefix: 'documents/' }
        : {}),
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: config.storage.retainOnDelete
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.storage.retainOnDelete,
      lifecycleRules: [
        {
          id: 'expire-noncurrent-versions',
          noncurrentVersionExpiration: cdk.Duration.days(
            config.storage.noncurrentVersionExpiryDays,
          ),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // ---- App secrets ---------------------------------------------------------------------------------
    const generated = (id: string, name: string, description: string) =>
      new secretsmanager.Secret(this, id, {
        secretName: `hilatech/${config.name}/${name}`,
        description,
        generateSecretString: { passwordLength: 64, excludePunctuation: true },
      });
    this.jwtAccessSecret = generated(
      'JwtAccess',
      'jwt-access-secret',
      'JWT_ACCESS_SECRET (generated)',
    );
    this.jwtRefreshSecret = generated(
      'JwtRefresh',
      'jwt-refresh-secret',
      'JWT_REFRESH_SECRET (generated)',
    );
    // CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key, which Secrets Manager cannot generate.
    // The placeholder below is rejected by the app's env validation (fail closed) until you replace it:
    //   aws secretsmanager put-secret-value --secret-id hilatech/<env>/credentials-encryption-key \
    //     --secret-string "$(openssl rand -base64 32)"
    // BACK THIS KEY UP: losing it makes every stored organization AI credential unrecoverable.
    this.credentialsKeySecret = new secretsmanager.Secret(this, 'CredentialsKey', {
      secretName: `hilatech/${config.name}/credentials-encryption-key`,
      description: 'CREDENTIALS_ENCRYPTION_KEY (base64 32 bytes). SET MANUALLY after first deploy.',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        'SET-ME-base64-32-bytes-openssl-rand-base64-32',
      ),
    });

    // ---- AWS Backup ------------------------------------------------------------------------------------
    if (config.backup.enabled) {
      const vault = new backup.BackupVault(this, 'Vault', {
        backupVaultName: `hilatech-${config.name}`,
        removalPolicy: removal,
      });
      const plan = new backup.BackupPlan(this, 'Plan', {
        backupPlanName: `hilatech-${config.name}`,
        backupVault: vault,
      });
      plan.addRule(
        new backup.BackupPlanRule({
          ruleName: 'daily',
          scheduleExpression: events.Schedule.cron({ minute: '0', hour: '3' }),
          deleteAfter: cdk.Duration.days(config.backup.dailyRetentionDays),
          startWindow: cdk.Duration.hours(1),
          completionWindow: cdk.Duration.hours(4),
        }),
      );
      if (config.backup.monthlyRetentionDays) {
        plan.addRule(
          new backup.BackupPlanRule({
            ruleName: 'monthly',
            scheduleExpression: events.Schedule.cron({ minute: '30', hour: '3', day: '1' }),
            deleteAfter: cdk.Duration.days(config.backup.monthlyRetentionDays),
          }),
        );
      }
      const backupRole = new iam.Role(this, 'BackupRole', {
        assumedBy: new iam.ServicePrincipal('backup.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSBackupServiceRolePolicyForBackup',
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AWSBackupServiceRolePolicyForS3Backup'),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSBackupServiceRolePolicyForRestores',
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AWSBackupServiceRolePolicyForS3Restore'),
        ],
      });
      plan.addSelection('Selection', {
        role: backupRole,
        resources: [
          backup.BackupResource.fromRdsDatabaseInstance(this.db),
          backup.BackupResource.fromArn(this.documentsBucket.bucketArn),
        ],
      });
    }

    new cdk.CfnOutput(this, 'DbEndpoint', { value: this.db.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'DocumentsBucketName', { value: this.documentsBucket.bucketName });
    new cdk.CfnOutput(this, 'CredentialsKeySecretName', {
      value: this.credentialsKeySecret.secretName,
    });
  }
}
