import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import type { EnvConfig } from '../config';

export const SERVICE_NAMES = ['api', 'web', 'workers'] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface RegistryStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/** ECR repositories. Deployed first so images can be pushed before the App stack starts any task. */
export class RegistryStack extends cdk.Stack {
  readonly repos: Record<ServiceName, ecr.Repository>;

  constructor(scope: Construct, id: string, props: RegistryStackProps) {
    super(scope, id, props);
    const { config } = props;
    const prod = config.name === 'prod';
    const repos = {} as Record<ServiceName, ecr.Repository>;
    for (const name of SERVICE_NAMES) {
      repos[name] = new ecr.Repository(this, `${name}Repo`, {
        repositoryName: `hilatech-${config.name}/${name}`,
        imageScanOnPush: true,
        // Prod pins immutable tags (use the git SHA). Lower envs keep a mutable `latest` for convenience.
        imageTagMutability: prod ? ecr.TagMutability.IMMUTABLE : ecr.TagMutability.MUTABLE,
        encryption: ecr.RepositoryEncryption.AES_256,
        removalPolicy: config.storage.retainOnDelete
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
        emptyOnDelete: !config.storage.retainOnDelete,
        lifecycleRules: [{ description: 'Keep the last 20 images', maxImageCount: 20 }],
      });
    }
    this.repos = repos;
    for (const name of SERVICE_NAMES) {
      new cdk.CfnOutput(this, `${name}RepoUri`, { value: repos[name].repositoryUri });
    }
  }
}
