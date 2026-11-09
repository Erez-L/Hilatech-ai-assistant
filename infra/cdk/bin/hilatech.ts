#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ENV_CONFIGS, resolveEnvName } from '../lib/config';
import { applyNagAcknowledgements } from '../lib/nag-acknowledgements';
import { AppStack } from '../lib/stacks/app-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { NetworkStack } from '../lib/stacks/network-stack';
import { OpsStack } from '../lib/stacks/ops-stack';
import { RegistryStack } from '../lib/stacks/registry-stack';

/**
 * Usage (never deploys by itself):
 *   npx cdk synth -c env=dev            # also: staging, prod
 *   -c certificateArn=arn:aws:acm:...   # ACM cert in the stack region (HTTPS)
 *   -c domainName=app.example.com
 *   -c alarmEmail=you@example.com
 *   -c imageTag=<git-sha>
 *   -c pauseServices=true               # desiredCount 0 until images exist
 *
 * Account/region come from the CLI environment (CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION). Without credentials,
 * synth still works and uses environment-agnostic stacks with placeholder account/region tokens.
 */
const app = new cdk.App();
const config = ENV_CONFIGS[resolveEnvName(app.node.tryGetContext('env') ?? 'dev')];
const str = (key: string) => {
  const v = app.node.tryGetContext(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

// The cdk CLI sets CDK_DEFAULT_ACCOUNT/REGION from the active credentials/profile. With NO credentials (CI synth,
// local review) we fall back to a clearly fake account so ALB log-delivery and other region-aware constructs
// can synthesise. Such a template is for validation only; a real deploy always resolves the real account.
const SYNTH_ONLY_ACCOUNT = '000000000000';
const region = process.env.CDK_DEFAULT_REGION ?? str('region') ?? 'us-east-1';
const account = process.env.CDK_DEFAULT_ACCOUNT ?? str('account') ?? SYNTH_ONLY_ACCOUNT;
const env: cdk.Environment = { account, region };
if (account === SYNTH_ONLY_ACCOUNT) {
  // Pre-seed the AZ context CDK would otherwise look up with credentials, so credential-less synth is deterministic.
  app.node.setContext(`availability-zones:account=${account}:region=${region}`, [
    `${region}a`,
    `${region}b`,
  ]);
}
// Bedrock allowed regions default to the deployment region when known.
if (region && !config.bedrock.allowedRegions.includes(region))
  config.bedrock.allowedRegions.push(region);

const prefix = `HilaTech-${config.name}`;
const network = new NetworkStack(app, `${prefix}-Network`, { config, env });
const registry = new RegistryStack(app, `${prefix}-Registry`, { config, env });
const data = new DataStack(app, `${prefix}-Data`, { config, network, env });
const appStack = new AppStack(app, `${prefix}-App`, {
  config,
  network,
  data,
  registry,
  env,
  certificateArn: str('certificateArn'),
  domainName: str('domainName'),
  imageTag: str('imageTag') ?? 'latest',
  pauseServices:
    app.node.tryGetContext('pauseServices') === true ||
    app.node.tryGetContext('pauseServices') === 'true',
});
const ops = new OpsStack(app, `${prefix}-Ops`, {
  config,
  app: appStack,
  data,
  alarmEmail: str('alarmEmail'),
  env,
});

for (const stack of [network, registry, data, appStack, ops]) {
  cdk.Tags.of(stack).add('app', 'hilatech');
  cdk.Tags.of(stack).add('env', config.name);
}

if (app.node.tryGetContext('nag') !== 'false') {
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  applyNagAcknowledgements({ network, registry, data, app: appStack, ops, config });
}
