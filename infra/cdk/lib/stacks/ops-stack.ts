import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import type { EnvConfig } from '../config';
import type { AppStack } from './app-stack';
import type { DataStack } from './data-stack';

export interface OpsStackProps extends cdk.StackProps {
  config: EnvConfig;
  app: AppStack;
  data: DataStack;
  /** Alarm + budget e-mail. When empty the topic has no subscriber and the budget is skipped (with a warning). */
  alarmEmail?: string;
}

/** CloudWatch alarms + dashboard, SNS topic, and the AWS Budgets alarm. */
export class OpsStack extends cdk.Stack {
  readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: OpsStackProps) {
    super(scope, id, props);
    const { config, app, data, alarmEmail } = props;

    this.alarmTopic = new sns.Topic(this, 'Alarms', {
      topicName: `hilatech-${config.name}-alarms`,
      enforceSSL: true,
    });
    if (alarmEmail) {
      this.alarmTopic.addSubscription(new subs.EmailSubscription(alarmEmail));
    } else {
      cdk.Annotations.of(this).addWarning(
        'No alarmEmail context: alarms publish to SNS but nobody is subscribed and the AWS Budgets alarm is NOT created. Pass -c alarmEmail=you@example.com',
      );
    }
    const action = new cwActions.SnsAction(this.alarmTopic);
    const alarm = (
      id: string,
      metric: cloudwatch.IMetric,
      props: Partial<cloudwatch.AlarmProps> & { threshold: number; description: string },
    ) => {
      const a = new cloudwatch.Alarm(this, id, {
        metric,
        evaluationPeriods: 3,
        datapointsToAlarm: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmName: `hilatech-${config.name}-${id}`,
        alarmDescription: `${props.description} Runbook: docs/operations/runbooks.md`,
        ...props,
      });
      a.addAlarmAction(action);
      return a;
    };

    const alb = app.alb;
    const apiTg = app.targetGroups.api;
    const webTg = app.targetGroups.web;
    const fiveMin = cdk.Duration.minutes(5);

    alarm(
      'AlbTarget5xx',
      alb.metrics.httpCodeTarget(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'HTTPCode_Target_5XX_Count' as any,
        { period: fiveMin, statistic: 'Sum' },
      ),
      {
        threshold: 10,
        description: 'Application 5xx responses from targets (SLO: availability).',
      },
    );
    alarm(
      'ApiLatencyP95',
      apiTg.metrics.targetResponseTime({ period: fiveMin, statistic: 'p95' }),
      {
        threshold: 2,
        description: 'API p95 target response time above 2s (SLO: latency).',
      },
    );
    alarm(
      'ApiUnhealthyHosts',
      apiTg.metrics.unhealthyHostCount({ period: cdk.Duration.minutes(1), statistic: 'Maximum' }),
      {
        threshold: 0,
        description: 'API has unhealthy targets.',
      },
    );
    alarm(
      'WebUnhealthyHosts',
      webTg.metrics.unhealthyHostCount({ period: cdk.Duration.minutes(1), statistic: 'Maximum' }),
      {
        threshold: 0,
        description: 'Web has unhealthy targets.',
      },
    );
    for (const name of ['api', 'web', 'workers'] as const) {
      alarm(`${name}CpuHigh`, app.services[name].metricCpuUtilization({ period: fiveMin }), {
        threshold: 85,
        description: `${name} service CPU sustained above 85% (at max scale this means saturation).`,
      });
      alarm(`${name}MemoryHigh`, app.services[name].metricMemoryUtilization({ period: fiveMin }), {
        threshold: 90,
        description: `${name} service memory sustained above 90% (OOM-kill risk).`,
      });
    }
    alarm('DbCpuHigh', data.db.metricCPUUtilization({ period: fiveMin }), {
      threshold: 80,
      description: 'RDS CPU above 80%.',
    });
    alarm(
      'DbFreeStorageLow',
      data.db.metricFreeStorageSpace({ period: fiveMin, statistic: 'Minimum' }),
      {
        threshold: 2 * 1024 ** 3,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        description: 'RDS free storage below 2 GiB (storage autoscaling may be capped).',
      },
    );
    alarm('DbConnectionsHigh', data.db.metricDatabaseConnections({ period: fiveMin }), {
      threshold: config.database.instanceClass.includes('micro') ? 60 : 150,
      description:
        'RDS connection count high (placeholder threshold: tune to your instance max_connections).',
    });
    if (data.redis) {
      const redisMetric = (metricName: string, statistic: string) =>
        new cloudwatch.Metric({
          namespace: 'AWS/ElastiCache',
          metricName,
          dimensionsMap: { ReplicationGroupId: data.redis!.ref },
          period: fiveMin,
          statistic,
        });
      alarm('RedisMemoryHigh', redisMetric('DatabaseMemoryUsagePercentage', 'Maximum'), {
        threshold: 80,
        description: 'Redis memory above 80%. Policy is noeviction: at 100% BullMQ enqueue fails.',
      });
      alarm('RedisCpuHigh', redisMetric('EngineCPUUtilization', 'Average'), {
        threshold: 80,
        description: 'Redis engine CPU above 80%.',
      });
    }

    // ---- Dashboard ---------------------------------------------------------------------------------------------------
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `hilatech-${config.name}`,
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ALB requests / target 5xx',
        left: [alb.metrics.requestCount({ period: fiveMin })],
        right: [
          alb.metrics.httpCodeTarget('HTTPCode_Target_5XX_Count' as never, { period: fiveMin }),
        ],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'API response time (p50 / p95)',
        left: [
          apiTg.metrics.targetResponseTime({ period: fiveMin, statistic: 'p50' }),
          apiTg.metrics.targetResponseTime({ period: fiveMin, statistic: 'p95' }),
        ],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'Healthy / unhealthy targets',
        left: [apiTg.metrics.healthyHostCount(), webTg.metrics.healthyHostCount()],
        right: [apiTg.metrics.unhealthyHostCount(), webTg.metrics.unhealthyHostCount()],
        width: 8,
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ECS CPU %',
        left: (['api', 'web', 'workers'] as const).map((n) =>
          app.services[n].metricCpuUtilization({ label: n }),
        ),
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'ECS memory %',
        left: (['api', 'web', 'workers'] as const).map((n) =>
          app.services[n].metricMemoryUtilization({ label: n }),
        ),
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS CPU / connections',
        left: [data.db.metricCPUUtilization()],
        right: [data.db.metricDatabaseConnections()],
        width: 8,
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'RDS free storage / freeable memory',
        left: [data.db.metricFreeStorageSpace()],
        right: [data.db.metricFreeableMemory()],
        width: 12,
      }),
    );

    // ---- AWS Budgets ----------------------------------------------------------------------------------------------------
    // Budgets are account-level and delayed (cost data lags by hours). They warn, they do NOT stop spending.
    if (config.budget.enabled && alarmEmail) {
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: `hilatech-${config.name}-monthly`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: config.budget.monthlyLimitUsd, unit: 'USD' },
          costFilters: { TagKeyValue: [`user:app$hilatech`] },
        },
        notificationsWithSubscribers: [
          ...[50, 80, 100].map((threshold) => ({
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: alarmEmail }],
          })),
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: alarmEmail }],
          },
        ],
      });
    }
  }
}
