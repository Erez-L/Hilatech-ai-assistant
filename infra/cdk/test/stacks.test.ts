import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ENV_CONFIGS, type EnvName } from '../lib/config';
import { AppStack } from '../lib/stacks/app-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { NetworkStack } from '../lib/stacks/network-stack';
import { OpsStack } from '../lib/stacks/ops-stack';
import { RegistryStack } from '../lib/stacks/registry-stack';

/**
 * Template assertions only: nothing here talks to AWS and nothing is deployed. They guard the properties the
 * architecture documents promise (private data tier, encrypted storage, scoped IAM, per-env sizing).
 */
function build(
  envName: EnvName,
  ctx: {
    certificateArn?: string;
    domainName?: string;
    alarmEmail?: string;
    pauseServices?: boolean;
  } = {},
) {
  const app = new cdk.App({
    context: {
      'availability-zones:account=000000000000:region=us-east-1': ['us-east-1a', 'us-east-1b'],
    },
  });
  const env = { account: '000000000000', region: 'us-east-1' };
  const config = structuredClone(ENV_CONFIGS[envName]);
  const network = new NetworkStack(app, 'Net', { config, env });
  const registry = new RegistryStack(app, 'Reg', { config, env });
  const data = new DataStack(app, 'Data', { config, network, env });
  const appStack = new AppStack(app, 'App', {
    config,
    network,
    data,
    registry,
    env,
    imageTag: 'test',
    ...ctx,
  });
  const ops = new OpsStack(app, 'Ops', {
    config,
    app: appStack,
    data,
    alarmEmail: ctx.alarmEmail,
    env,
  });
  return {
    net: Template.fromStack(network),
    data: Template.fromStack(data),
    app: Template.fromStack(appStack),
    ops: Template.fromStack(ops),
    reg: Template.fromStack(registry),
  };
}

const iamStatements = (
  template: Template,
): Array<{ Action: string | string[]; Resource: unknown; Effect: string }> =>
  Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
    (p) => (p.Properties as { PolicyDocument: { Statement: never[] } }).PolicyDocument.Statement,
  );

describe.each(['dev', 'staging', 'prod'] as const)('%s', (envName) => {
  const t = build(envName, { alarmEmail: 'ops@example.com' });
  const cfg = ENV_CONFIGS[envName];

  it('has a private, encrypted PostgreSQL instance sized per environment', () => {
    t.data.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      StorageEncrypted: true,
      PubliclyAccessible: false,
      MultiAZ: cfg.database.multiAz,
      DBInstanceClass: `db.${cfg.database.instanceClass}`,
      DeletionProtection: cfg.database.deletionProtection,
    });
  });

  it('blocks all public access to the documents bucket and enforces TLS + versioning', () => {
    t.data.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: { Status: 'Enabled' },
      BucketEncryption: Match.anyValue(),
    });
    t.data.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('keeps Redis encrypted in transit and at rest with noeviction (BullMQ)', () => {
    t.data.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      AtRestEncryptionEnabled: true,
      TransitEncryptionEnabled: true,
    });
    t.data.hasResourceProperties('AWS::ElastiCache::ParameterGroup', {
      Properties: { 'maxmemory-policy': 'noeviction' },
    });
  });

  it('never grants bedrock:* or an unscoped Bedrock resource', () => {
    const bedrock = iamStatements(t.app).filter((s) =>
      JSON.stringify(s.Action).includes('bedrock:'),
    );
    expect(bedrock.length).toBeGreaterThan(0);
    for (const s of bedrock) {
      const actions = ([] as string[]).concat(s.Action);
      expect(actions.sort()).toEqual([
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ]);
      expect(JSON.stringify(s.Resource)).not.toBe('"*"');
      expect(JSON.stringify(s.Resource)).toContain('foundation-model/');
    }
  });

  it('gives the web and migrate tasks no application permissions', () => {
    const roles = t.app.findResources('AWS::IAM::Role');
    const web = Object.keys(roles).find((k) => k.startsWith('WebTaskRole'));
    const migrate = Object.keys(roles).find((k) => k.startsWith('MigrateTaskRole'));
    expect(web && migrate).toBeTruthy();
    const policies = Object.values(t.app.findResources('AWS::IAM::Policy'));
    for (const prefix of ['WebTaskRole', 'MigrateTaskRole']) {
      const attached = policies.filter((p) =>
        JSON.stringify((p.Properties as { Roles: unknown }).Roles).includes(prefix),
      );
      const statements = attached.flatMap(
        (p) =>
          (p.Properties as { PolicyDocument: { Statement: unknown[] } }).PolicyDocument.Statement,
      );
      // Only ECS Exec (dev/staging) is tolerated; no S3/Bedrock/Secrets access.
      expect(JSON.stringify(statements)).not.toMatch(/s3:|bedrock:|secretsmanager:/);
    }
  });

  it('never puts secret values in container environment variables', () => {
    const tasks = Object.values(t.app.findResources('AWS::ECS::TaskDefinition'));
    for (const task of tasks) {
      const containers = (
        task.Properties as {
          ContainerDefinitions: Array<{ Environment?: Array<{ Name: string }> }>;
        }
      ).ContainerDefinitions;
      for (const c of containers) {
        const names = (c.Environment ?? []).map((e) => e.Name);
        for (const secretName of [
          'DATABASE_URL',
          'REDIS_URL',
          'JWT_ACCESS_SECRET',
          'JWT_REFRESH_SECRET',
          'CREDENTIALS_ENCRYPTION_KEY',
        ]) {
          expect(names).not.toContain(secretName);
        }
      }
    }
  });

  it('creates three services, each with its own scalable target and CPU policy', () => {
    t.app.resourceCountIs('AWS::ECS::Service', 3);
    t.app.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 3);
    t.app.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: cfg.services.api.minTasks,
      MaxCapacity: cfg.services.api.maxTasks,
    });
  });

  it('creates the WAF association only where configured', () => {
    if (cfg.waf.enabled) {
      t.app.resourceCountIs('AWS::WAFv2::WebACL', 1);
      t.app.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    } else {
      t.app.resourceCountIs('AWS::WAFv2::WebACL', 0);
    }
  });

  it('creates backup plan only where configured', () => {
    t.data.resourceCountIs('AWS::Backup::BackupPlan', cfg.backup.enabled ? 1 : 0);
  });

  it('creates alarms, a dashboard and a budget when an e-mail is supplied', () => {
    expect(
      Object.keys(t.ops.findResources('AWS::CloudWatch::Alarm')).length,
    ).toBeGreaterThanOrEqual(10);
    t.ops.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    t.ops.resourceCountIs('AWS::Budgets::Budget', 1);
  });

  it('uses NAT gateways per config and S3 gateway endpoint', () => {
    t.net.resourceCountIs('AWS::EC2::NatGateway', cfg.natGateways);
    t.net.hasResourceProperties('AWS::EC2::VPCEndpoint', { VpcEndpointType: 'Gateway' });
  });
});

describe('listeners', () => {
  it('serves HTTP only without a certificate', () => {
    const t = build('dev');
    t.app.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 1);
    t.app.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP',
    });
  });
  it('serves HTTPS and redirects HTTP when a certificate is supplied', () => {
    const t = build('dev', {
      certificateArn:
        'arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555',
      domainName: 'app.example.com',
    });
    t.app.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
    });
    t.app.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: 'redirect' })],
    });
  });
});

describe('pauseServices', () => {
  it('sets desired count 0 and removes autoscaling so paused services stay paused', () => {
    const t = build('dev', { pauseServices: true });
    t.app.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 0);
    const services = Object.values(t.app.findResources('AWS::ECS::Service'));
    expect(services).toHaveLength(3);
    for (const svc of services)
      expect((svc.Properties as { DesiredCount: number }).DesiredCount).toBe(0);
  });
});

describe('sizing', () => {
  it('keeps dev small and prod highly available', () => {
    expect(ENV_CONFIGS.dev.natGateways).toBe(1);
    expect(ENV_CONFIGS.dev.database.multiAz).toBe(false);
    expect(ENV_CONFIGS.dev.services.api.minTasks).toBe(1);
    expect(ENV_CONFIGS.prod.database.multiAz).toBe(true);
    expect(ENV_CONFIGS.prod.services.api.minTasks).toBeGreaterThanOrEqual(2);
    expect(ENV_CONFIGS.prod.natGateways).toBe(2);
  });
});
