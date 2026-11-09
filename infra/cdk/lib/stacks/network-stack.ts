import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { EnvConfig } from '../config';

export interface NetworkStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/**
 * VPC (2 AZ): public subnets (ALB, NAT), private-with-egress subnets (Fargate tasks), isolated subnets (RDS,
 * ElastiCache - no route to the internet). All security groups live here so cross-stack rules cannot form cycles.
 */
export class NetworkStack extends cdk.Stack {
  readonly vpc: ec2.Vpc;
  readonly albSg: ec2.SecurityGroup;
  readonly apiSg: ec2.SecurityGroup;
  readonly webSg: ec2.SecurityGroup;
  readonly workersSg: ec2.SecurityGroup;
  readonly migrateSg: ec2.SecurityGroup;
  readonly dbSg: ec2.SecurityGroup;
  readonly redisSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: config.azCount,
      natGateways: config.natGateways,
      ipAddresses: ec2.IpAddresses.cidr('10.40.0.0/16'),
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      restrictDefaultSecurityGroup: true,
    });

    if (config.flowLogs) {
      const flowLogGroup = new logs.LogGroup(this, 'FlowLogs', {
        retention: config.logRetentionDays as logs.RetentionDays,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      this.vpc.addFlowLog('FlowLog', {
        destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup),
        trafficType: ec2.FlowLogTrafficType.REJECT, // REJECT only keeps volume (and cost) low
      });
    }

    // Free gateway endpoint: S3 traffic (documents, ECR layers) never goes through NAT.
    this.vpc.addGatewayEndpoint('S3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });

    const sg = (name: string, description: string, allowAllOutbound = true) =>
      new ec2.SecurityGroup(this, name, { vpc: this.vpc, description, allowAllOutbound });

    this.albSg = sg('AlbSg', 'Public ALB');
    this.apiSg = sg('ApiSg', 'API tasks');
    this.webSg = sg('WebSg', 'Web tasks');
    this.workersSg = sg('WorkersSg', 'Worker tasks');
    this.migrateSg = sg('MigrateSg', 'One-off migration task');
    this.dbSg = sg('DbSg', 'PostgreSQL', false);
    this.redisSg = sg('RedisSg', 'Redis', false);

    this.albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP (redirects to HTTPS when a certificate is set)',
    );
    this.albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    this.apiSg.addIngressRule(this.albSg, ec2.Port.tcp(4000), 'ALB to API');
    this.webSg.addIngressRule(this.albSg, ec2.Port.tcp(3000), 'ALB to web');
    for (const client of [this.apiSg, this.workersSg, this.migrateSg]) {
      this.dbSg.addIngressRule(client, ec2.Port.tcp(5432), 'PostgreSQL from app tier');
    }
    for (const client of [this.apiSg, this.workersSg]) {
      this.redisSg.addIngressRule(client, ec2.Port.tcp(6379), 'Redis from app tier');
    }

    if (config.interfaceEndpoints) {
      const endpointSg = sg('EndpointSg', 'Interface VPC endpoints', false);
      for (const client of [this.apiSg, this.webSg, this.workersSg, this.migrateSg]) {
        endpointSg.addIngressRule(client, ec2.Port.tcp(443), 'HTTPS from tasks');
      }
      const services: Record<string, ec2.InterfaceVpcEndpointAwsService> = {
        EcrApi: ec2.InterfaceVpcEndpointAwsService.ECR,
        EcrDkr: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        Logs: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
        Secrets: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        BedrockRuntime: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
      };
      for (const [name, service] of Object.entries(services)) {
        this.vpc.addInterfaceEndpoint(`${name}Endpoint`, {
          service,
          securityGroups: [endpointSg],
          open: false, // only the task security groups above may reach the endpoints
          subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        });
      }
    }

    cdk.Tags.of(this).add('app', 'hilatech');
  }
}
