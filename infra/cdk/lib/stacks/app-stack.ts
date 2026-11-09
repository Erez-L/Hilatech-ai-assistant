import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import type { EnvConfig, ServiceSizing } from '../config';
import type { DataStack } from './data-stack';
import type { NetworkStack } from './network-stack';
import type { RegistryStack, ServiceName } from './registry-stack';

export interface AppStackProps extends cdk.StackProps {
  config: EnvConfig;
  network: NetworkStack;
  data: DataStack;
  registry: RegistryStack;
  /** ACM certificate ARN in this region. Without it the ALB serves HTTP only (smoke tests, no login). */
  certificateArn?: string;
  /** Public host name, e.g. app.example.com. Without it the ALB DNS name is used for APP_URL/CORS. */
  domainName?: string;
  imageTag: string;
  /** Start services with desiredCount 0 (use before images exist or for a paused environment). */
  pauseServices?: boolean;
}

/**
 * Compute: ECS Fargate cluster, ALB (+ optional WAF), api / web / workers services with separate scaling
 * policies, least-privilege task roles, and a one-off migration task definition.
 */
export class AppStack extends cdk.Stack {
  readonly cluster: ecs.Cluster;
  readonly alb: elbv2.ApplicationLoadBalancer;
  readonly services: Record<ServiceName, ecs.FargateService>;
  readonly logGroups: Record<ServiceName | 'migrate', logs.LogGroup>;
  readonly targetGroups: { api: elbv2.ApplicationTargetGroup; web: elbv2.ApplicationTargetGroup };
  readonly taskRoles: Record<ServiceName | 'migrate', iam.Role>;
  readonly migrateTaskDefinition: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { config, network, data, registry } = props;
    const httpsEnabled = Boolean(props.certificateArn);
    const prod = config.name === 'prod';

    if (!httpsEnabled) {
      cdk.Annotations.of(this).addWarning(
        'No certificateArn: the ALB serves HTTP only. The API sets Secure cookies in production, so login will NOT work. ' +
          'Use this only to smoke-test /api/v1/health. Pass -c certificateArn=arn:aws:acm:... and -c domainName=...',
      );
    }

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: network.vpc,
      clusterName: `hilatech-${config.name}`,
      containerInsightsV2: prod ? ecs.ContainerInsights.ENABLED : ecs.ContainerInsights.DISABLED,
    });

    // ---- Load balancer ----------------------------------------------------------------------------------
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: network.vpc,
      internetFacing: true,
      securityGroup: network.albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      deletionProtection: config.alb.deletionProtection,
      idleTimeout: cdk.Duration.seconds(config.alb.idleTimeoutSeconds), // SSE / streamed AI responses
      dropInvalidHeaderFields: true,
    });
    if (data.accessLogsBucket) this.alb.logAccessLogs(data.accessLogsBucket, 'alb');

    const publicHost = props.domainName ?? this.alb.loadBalancerDnsName;
    const scheme = httpsEnabled ? 'https' : 'http';
    const publicUrl = `${scheme}://${publicHost}`;

    this.targetGroups = {
      api: new elbv2.ApplicationTargetGroup(this, 'ApiTg', {
        vpc: network.vpc,
        port: 4000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        deregistrationDelay: cdk.Duration.seconds(30),
        healthCheck: {
          path: '/api/v1/health',
          healthyHttpCodes: '200',
          interval: cdk.Duration.seconds(30),
        },
      }),
      web: new elbv2.ApplicationTargetGroup(this, 'WebTg', {
        vpc: network.vpc,
        port: 3000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        deregistrationDelay: cdk.Duration.seconds(30),
        healthCheck: { path: '/', healthyHttpCodes: '200-399', interval: cdk.Duration.seconds(30) },
      }),
    };

    const attachRouting = (listener: elbv2.ApplicationListener) => {
      listener.addAction('Api', {
        priority: 10,
        conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*'])],
        action: elbv2.ListenerAction.forward([this.targetGroups.api]),
      });
    };
    if (httpsEnabled) {
      const https = this.alb.addListener('Https', {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [
          acm.Certificate.fromCertificateArn(this, 'Cert', props.certificateArn as string),
        ],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        defaultAction: elbv2.ListenerAction.forward([this.targetGroups.web]),
      });
      attachRouting(https);
      this.alb.addListener('HttpRedirect', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });
    } else {
      const http = this.alb.addListener('Http', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: elbv2.ListenerAction.forward([this.targetGroups.web]),
      });
      attachRouting(http);
    }

    if (config.waf.enabled) this.addWaf(config);

    // ---- IAM: one task role per workload, nothing shared ----------------------------------------------------
    const mkRole = (name: string) =>
      new iam.Role(this, `${name}TaskRole`, {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com', {
          conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
        }),
        description: `HilaTech ${config.name} ${name} task role (least privilege)`,
      });
    const taskRoles = {
      api: mkRole('Api'),
      web: mkRole('Web'), // intentionally has no permissions: the web tier never calls AWS APIs
      workers: mkRole('Workers'),
      migrate: mkRole('Migrate'), // intentionally has no permissions: reaches PostgreSQL over the network only
    };
    this.taskRoles = taskRoles;

    for (const name of ['api', 'workers'] as const) {
      // Documents bucket: explicit object actions + list. No bucket-policy, ACL or wildcard S3 actions.
      taskRoles[name].addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: 'DocumentObjects',
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
          resources: [data.documentsBucket.arnForObjects('*')],
        }),
      );
      taskRoles[name].addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: 'DocumentList',
          actions: ['s3:ListBucket'],
          resources: [data.documentsBucket.bucketArn],
        }),
      );
      if (config.bedrock.enabled) this.grantBedrock(taskRoles[name], config);
    }

    // ---- Services ----------------------------------------------------------------------------------------------
    const logGroup = (name: ServiceName | 'migrate') =>
      new logs.LogGroup(this, `${name}Logs`, {
        logGroupName: `/hilatech/${config.name}/${name}`,
        retention: config.logRetentionDays as logs.RetentionDays,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    this.logGroups = {
      api: logGroup('api'),
      web: logGroup('web'),
      workers: logGroup('workers'),
      migrate: logGroup('migrate'),
    };

    const secret = (s: import('aws-cdk-lib/aws-secretsmanager').ISecret) =>
      ecs.Secret.fromSecretsManager(s);
    const commonEnv: Record<string, string> = {
      NODE_ENV: 'production',
      LOG_LEVEL: prod ? 'info' : 'debug',
      APP_URL: publicUrl,
      AWS_REGION: this.region,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: data.documentsBucket.bucketName,
      S3_REGION: this.region,
      EMAIL_DRIVER: 'log', // SES/SMTP is not wired by this stack; see docs/architecture/aws-architecture.md
    };
    const commonSecrets: Record<string, ecs.Secret> = {
      DATABASE_URL: secret(data.databaseUrlSecret),
      CREDENTIALS_ENCRYPTION_KEY: secret(data.credentialsKeySecret),
      REDIS_URL: secret(data.redisUrlSecret),
    };

    const runtimePlatform: ecs.RuntimePlatform = {
      cpuArchitecture:
        config.cpuArchitecture === 'ARM64' ? ecs.CpuArchitecture.ARM64 : ecs.CpuArchitecture.X86_64,
      operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    };

    const makeTaskDef = (
      name: ServiceName | 'migrate',
      sizing: Pick<ServiceSizing, 'cpu' | 'memoryMiB'>,
    ) =>
      new ecs.FargateTaskDefinition(this, `${name}Task`, {
        cpu: sizing.cpu,
        memoryLimitMiB: sizing.memoryMiB,
        taskRole: taskRoles[name],
        runtimePlatform,
      });

    const image = (name: ServiceName) =>
      ecs.ContainerImage.fromEcrRepository(registry.repos[name], props.imageTag);

    const services = {} as Record<ServiceName, ecs.FargateService>;
    const desired = (sizing: ServiceSizing) => (props.pauseServices ? 0 : sizing.minTasks);

    // API
    const apiTask = makeTaskDef('api', config.services.api);
    apiTask.addContainer('api', {
      image: image('api'),
      essential: true,
      portMappings: [{ containerPort: 4000 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup: this.logGroups.api }),
      stopTimeout: cdk.Duration.seconds(30),
      environment: {
        ...commonEnv,
        API_PORT: '4000',
        API_URL: publicUrl,
        CORS_ORIGINS: publicUrl,
        TRUST_PROXY: 'true',
        COOKIE_SECURE: 'true',
        SWAGGER_ENABLED: 'false',
        AI_BEDROCK_ENABLED: String(config.bedrock.enabled),
      },
      secrets: {
        ...commonSecrets,
        JWT_ACCESS_SECRET: secret(data.jwtAccessSecret),
        JWT_REFRESH_SECRET: secret(data.jwtRefreshSecret),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:4000/api/v1/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    // Web (Next.js). NEXT_PUBLIC_* values are baked into the image at BUILD time (see the setup guide).
    const webTask = makeTaskDef('web', config.services.web);
    webTask.addContainer('web', {
      image: image('web'),
      essential: true,
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'web', logGroup: this.logGroups.web }),
      environment: { NODE_ENV: 'production', PORT: '3000', HOSTNAME: '0.0.0.0' },
    });

    // Workers (BullMQ consumers; no inbound traffic except the container health check)
    const workersTask = makeTaskDef('workers', config.services.workers);
    workersTask.addContainer('workers', {
      image: image('workers'),
      essential: true,
      portMappings: [{ containerPort: 4100 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'workers',
        logGroup: this.logGroups.workers,
      }),
      stopTimeout: cdk.Duration.seconds(60), // let in-flight jobs drain (SHUTDOWN_TIMEOUT_SECONDS=30)
      environment: {
        ...commonEnv,
        WORKERS_HEALTH_PORT: '4100',
        SHUTDOWN_TIMEOUT_SECONDS: '30',
        WORKER_CONCURRENCY: '5',
      },
      secrets: commonSecrets,
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:4100/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    const mkService = (
      name: ServiceName,
      task: ecs.FargateTaskDefinition,
      sg: ec2.ISecurityGroup,
      sizing: ServiceSizing,
    ) => {
      const service = new ecs.FargateService(this, `${name}Service`, {
        cluster: this.cluster,
        serviceName: `hilatech-${config.name}-${name}`,
        taskDefinition: task,
        desiredCount: desired(sizing),
        securityGroups: [sg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assignPublicIp: false,
        minHealthyPercent: prod ? 100 : 50,
        maxHealthyPercent: 200,
        healthCheckGracePeriod: name === 'workers' ? undefined : cdk.Duration.seconds(90),
        circuitBreaker: { rollback: true },
        enableExecuteCommand: !prod, // `aws ecs execute-command` for debugging outside prod only
      });
      // Separate target-tracking scaling policy per service. Skipped while paused: a scalable target with
      // minCapacity >= 1 would immediately scale a paused (desiredCount 0) service back up.
      if (!props.pauseServices) {
        const scaling = service.autoScaleTaskCount({
          minCapacity: sizing.minTasks,
          maxCapacity: sizing.maxTasks,
        });
        scaling.scaleOnCpuUtilization(`${name}Cpu`, {
          targetUtilizationPercent: sizing.targetCpuPercent,
          scaleInCooldown: cdk.Duration.minutes(5),
          scaleOutCooldown: cdk.Duration.minutes(1),
        });
        if (name !== 'workers') {
          scaling.scaleOnMemoryUtilization(`${name}Memory`, { targetUtilizationPercent: 75 });
        }
      }
      services[name] = service;
      return service;
    };

    mkService('api', apiTask, network.apiSg, config.services.api).attachToApplicationTargetGroup(
      this.targetGroups.api,
    );
    mkService('web', webTask, network.webSg, config.services.web).attachToApplicationTargetGroup(
      this.targetGroups.web,
    );
    mkService('workers', workersTask, network.workersSg, config.services.workers);
    this.services = services;

    // ---- One-off migration task (run with `aws ecs run-task`; never a long-running service) -----------------------
    this.migrateTaskDefinition = makeTaskDef('migrate', { cpu: 512, memoryMiB: 1024 });
    this.migrateTaskDefinition.addContainer('migrate', {
      image: image('api'),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'migrate',
        logGroup: this.logGroups.migrate,
      }),
      command: [
        'node',
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        'node_modules/@hilatech/database/prisma.config.ts',
      ],
      environment: { NODE_ENV: 'production' },
      secrets: { DATABASE_URL: secret(data.databaseUrlSecret) },
    });

    // ---- Outputs ----------------------------------------------------------------------------------------------------
    const privateSubnets = network.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    }).subnetIds;
    new cdk.CfnOutput(this, 'AlbDnsName', { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'PublicUrl', { value: publicUrl });
    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, 'MigrateTaskDefinition', { value: this.migrateTaskDefinition.family });
    new cdk.CfnOutput(this, 'MigrateSubnets', { value: cdk.Fn.join(',', privateSubnets) });
    new cdk.CfnOutput(this, 'MigrateSecurityGroup', { value: network.migrateSg.securityGroupId });
  }

  /**
   * bedrock:InvokeModel* scoped to explicit foundation-model ARNs (per allowed region) and this account's
   * inference profiles. No `bedrock:*`, no `Resource: *`. Cross-region inference profiles need the destination
   * regions in `allowedRegions` (see docs/architecture/aws-capability-matrix.md).
   */
  private grantBedrock(role: iam.IRole, config: EnvConfig): void {
    const geoPrefix = /^(global|us|eu|apac|us-gov)\./;
    const regions = config.bedrock.allowedRegions;
    const direct = config.bedrock.allowedModelIds.filter((id) => !geoPrefix.test(id));
    const regional = config.bedrock.allowedModelIds.filter((id) =>
      /^(us|eu|apac|us-gov)\./.test(id),
    );
    const global = config.bedrock.allowedModelIds.filter((id) => id.startsWith('global.'));
    const baseId = (id: string) => id.replace(geoPrefix, '');
    const fm = (region: string, id: string) =>
      `arn:${this.partition}:bedrock:${region}::foundation-model/${id}`;
    const profile = (region: string, id: string) =>
      `arn:${this.partition}:bedrock:${region}:${this.account}:inference-profile/${id}`;
    const actions = ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'];

    // 1. Direct on-demand foundation models in the allowed regions.
    // 2. Geography profiles (us./eu./apac.): the profile ARN + the underlying model in the allowed regions
    //    (destination regions of the profile must be listed in allowedRegions).
    const resources = [
      ...regions.flatMap((r) => direct.map((id) => fm(r, id))),
      ...regions.flatMap((r) => regional.map((id) => profile(r, id))),
      ...regions.flatMap((r) => regional.map((id) => fm(r, baseId(id)))),
      ...regions.flatMap((r) => global.map((id) => profile(r, id))),
    ];
    if (resources.length > 0) {
      role.addToPrincipalPolicy(
        new iam.PolicyStatement({ sid: 'BedrockInvokeScoped', actions, resources }),
      );
    }
    // 3. Global profiles route to any commercial region, so the underlying model ARN can only be region-wildcarded.
    //    It is restricted to calls made THROUGH this account's global profile via the InferenceProfileArn condition.
    //    UNVERIFIED against a live account - see docs/architecture/aws-capability-matrix.md. If InvokeModel is denied,
    //    read the CloudTrail event for the exact resource ARN and adjust.
    if (global.length > 0) {
      role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: 'BedrockGlobalProfileUnderlyingModels',
          actions,
          resources: global.map((id) => fm('*', baseId(id))),
          conditions: {
            StringLike: { 'bedrock:InferenceProfileArn': global.map((id) => profile('*', id)) },
          },
        }),
      );
    }
  }

  private addWaf(config: EnvConfig): void {
    const rule = (
      name: string,
      priority: number,
      vendorName: string,
      ruleName: string,
      ruleActionOverrides?: { name: string; actionToUse: { count: Record<string, never> } }[],
    ) => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName,
          name: ruleName,
          ...(ruleActionOverrides ? { ruleActionOverrides } : {}),
        },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: name,
        sampledRequestsEnabled: true,
      },
    });
    const acl = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `hilatech-${config.name}-acl`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'RateLimitPerIp',
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: { limit: config.waf.rateLimitPer5Min, aggregateKeyType: 'IP' },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitPerIp',
            sampledRequestsEnabled: true,
          },
        },
        // SizeRestrictions_BODY (8 KB body cap) would block document uploads and large AI payloads, so it only
        // counts. Review sampled requests / WAF logs before switching any rule from count to block.
        rule('AWSManagedCommon', 10, 'AWS', 'AWSManagedRulesCommonRuleSet', [
          { name: 'SizeRestrictions_BODY', actionToUse: { count: {} } },
        ]),
        rule('AWSManagedKnownBadInputs', 20, 'AWS', 'AWSManagedRulesKnownBadInputsRuleSet'),
        rule('AWSManagedIpReputation', 30, 'AWS', 'AWSManagedRulesAmazonIpReputationList'),
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: this.alb.loadBalancerArn,
      webAclArn: acl.attrArn,
    });
  }
}
