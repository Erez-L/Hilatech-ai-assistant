# Runbooks

All commands assume `ENV=dev|staging|prod`, `AWS_PROFILE` set and logged in (`aws sso login --profile <p>`), and
`AWS_REGION` exported. Resource names follow the CDK stacks (`HilaTech-$ENV-*`, cluster `hilatech-$ENV`, services
`hilatech-$ENV-api|web|workers`, log groups `/hilatech/$ENV/<svc>`). **None of these procedures has been executed
against a real deployment yet** - treat the first use as a drill and correct this file.

```bash
export ENV=dev
export CLUSTER=hilatech-$ENV
```

## 0. First response checklist (any alarm)

1. Open the dashboard `hilatech-$ENV` (CloudWatch -> Dashboards). Note start time and which graph moved first.
2. `aws ecs describe-services --cluster $CLUSTER --services hilatech-$ENV-api hilatech-$ENV-web hilatech-$ENV-workers --query 'services[].{n:serviceName,run:runningCount,want:desiredCount,events:events[0:3].message}'`
3. Check the last deployment: `aws ecs describe-services ... --query 'services[].deployments'`. A failed rollout is the most common cause - the circuit breaker rolls back automatically; confirm which task definition revision is active.
4. Tail logs (below). 5. Decide: roll back, scale, or fix forward. 6. Write down what you did (timeline) for the review.

```bash
aws logs tail /hilatech/$ENV/api --since 30m --follow
aws logs tail /hilatech/$ENV/workers --since 30m --filter-pattern ERROR
```

## 1. Deploy / roll back an application version

Deploy: push images tagged with the git SHA to ECR, then `cdk deploy HilaTech-$ENV-App -c env=$ENV -c imageTag=<sha> ...`
(or the manual `deploy-aws.yml`). **Run migrations first if the release has schema changes** (section 3), and make
migrations backward compatible with the previous app version (expand/contract) so rollback is safe.

Rollback (fast path, no CDK): point the service at the previous task definition revision.

```bash
CURRENT=$(aws ecs describe-services --cluster $CLUSTER --services hilatech-$ENV-api --query 'services[0].taskDefinition' --output text)
FAMILY=$(basename "$CURRENT" | cut -d: -f1)
aws ecs list-task-definitions --family-prefix "$FAMILY" --sort DESC --max-items 5   # newest first; pick the previous revision
aws ecs update-service --cluster $CLUSTER --service hilatech-$ENV-api --task-definition <previous-arn> --force-new-deployment
aws ecs wait services-stable --cluster $CLUSTER --services hilatech-$ENV-api
```

Then fix the repo state (`cdk deploy` with the old `imageTag`) so CloudFormation does not drift back.

## 2. Force a restart (e.g. after changing a secret)

Secrets are read at task start. After `put-secret-value`:

```bash
for s in api web workers; do aws ecs update-service --cluster $CLUSTER --service hilatech-$ENV-$s --force-new-deployment >/dev/null; done
aws ecs wait services-stable --cluster $CLUSTER --services hilatech-$ENV-api hilatech-$ENV-workers hilatech-$ENV-web
```

## 3. Run database migrations

```bash
OUT=$(aws cloudformation describe-stacks --stack-name HilaTech-$ENV-App --query 'Stacks[0].Outputs' --output json)
get() { echo "$OUT" | jq -r ".[] | select(.OutputKey==\"$1\").OutputValue"; }
TASK_ARN=$(aws ecs run-task --cluster $CLUSTER --task-definition "$(get MigrateTaskDefinition)" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$(get MigrateSubnets)],securityGroups=[$(get MigrateSecurityGroup)],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster $CLUSTER --tasks "$TASK_ARN"
aws ecs describe-tasks --cluster $CLUSTER --tasks "$TASK_ARN" --query 'tasks[0].containers[0].{exit:exitCode,reason:reason}'
aws logs tail /hilatech/$ENV/migrate --since 15m
```

Exit code 0 = applied. Non-zero: read the log; the migration runs in one transaction per file, so a failure leaves
earlier migrations applied. Do **not** run `migrate resolve` or edit `_prisma_migrations` without a fresh snapshot.
Take a manual snapshot before any destructive migration (section 6).

## 4. Scale

Temporary manual scale (autoscaling will re-assert its own bounds; to hold a value, change `minTasks` in `lib/config.ts`):

```bash
aws application-autoscaling register-scalable-target --service-namespace ecs \
  --resource-id service/$CLUSTER/hilatech-$ENV-api --scalable-dimension ecs:service:DesiredCount --min-capacity 3 --max-capacity 10
```

Pause an environment's compute (keeps NAT/ALB/RDS/Redis billing): `cdk deploy HilaTech-$ENV-App -c env=$ENV -c pauseServices=true ...`.

## 5. Alarm playbooks

| Alarm                                     | Likely causes                                                                                | Actions                                                                                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AlbTarget5xx` / `ApiLatencyP95`          | bad deploy, DB saturation, upstream AI provider slow/throttled, pool exhaustion              | check recent deployment; RDS CPU/connections; `aws logs tail ... --filter-pattern '"rate_limited"'` for provider throttling; roll back (section 1)                                             |
| `ApiUnhealthyHosts` / `WebUnhealthyHosts` | crash loop (missing/placeholder secret!), failing health check, OOM                          | `aws ecs describe-tasks` on stopped tasks -> `stoppedReason`; most common first-deploy failure: `credentials-encryption-key` still the placeholder or `redis-url` placeholder (external Redis) |
| `*CpuHigh` / `*MemoryHigh`                | load, leak, undersized                                                                       | check scaling activity; raise `maxTasks`/size in config; memory kills show as `OutOfMemoryError: Container killed` in stopped reasons                                                          |
| `DbCpuHigh`                               | slow query (log_min_duration_statement=1s is on), missing index, vector search without index | Performance Insights (prod), `postgresql` log group; consider scaling the instance class                                                                                                       |
| `DbFreeStorageLow`                        | growth beyond `maxAllocatedStorageGiB`, WAL/log growth, large embeddings table               | raise `maxAllocatedStorageGiB`; investigate table sizes; storage cannot be shrunk later                                                                                                        |
| `DbConnectionsHigh`                       | too many tasks x pool size                                                                   | reduce pool/concurrency or scale up; RDS Proxy is not built. Threshold is a placeholder                                                                                                        |
| `RedisMemoryHigh`                         | job backlog (policy is noeviction: at 100% enqueue fails), leaked repeatable jobs            | inspect queue sizes with a Redis client from a task via ECS Exec (dev/staging); scale node type; purge dead jobs                                                                               |
| Budget e-mail                             | spend above threshold                                                                        | Cost Explorer by service; check NAT data, Bedrock tokens (usage page), forgotten environments                                                                                                  |

## 6. Manual database snapshot

```bash
DBID=$(aws cloudformation describe-stack-resources --stack-name HilaTech-$ENV-Data \
  --query "StackResources[?ResourceType=='AWS::RDS::DBInstance'].PhysicalResourceId" --output text)
aws rds create-db-snapshot --db-instance-identifier "$DBID" --db-snapshot-identifier "manual-$ENV-$(date -u +%Y%m%dT%H%M%SZ)"
```

## 7. Rotate secrets (manual)

| Secret                       | Procedure                                                                                                                                       | Impact                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `jwt-access-secret`          | `aws secretsmanager put-secret-value --secret-id hilatech/$ENV/jwt-access-secret --secret-string "$(openssl rand -base64 48                     | tr -d '=+/\n')"`, then section 2 | all access tokens invalid (users re-login or refresh) |
| `jwt-refresh-secret`         | same                                                                                                                                            | all sessions invalid             |
| `credentials-encryption-key` | **do not rotate casually** - stored org AI credentials are encrypted with it. Needs a re-encrypt migration that does not exist                  | data loss if replaced            |
| DB password                  | change in RDS (`aws rds modify-db-instance --master-user-password ...`), update **both** `db-credentials` and `database-url` secrets, section 2 | brief errors during restart      |
| `redis-auth-token`           | requires ElastiCache auth-token rotation procedure and updating `redis-url`; plan a maintenance window                                          | queue interruption               |

## 8. Bedrock problems

| Symptom                                                        | Check                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AccessDeniedException` on first call                          | Anthropic first-use form `PENDING`/missing (`aws bedrock get-foundation-model-availability --model-id <id>`); model not available in region; IAM resource ARN mismatch - read the CloudTrail `bedrock.amazonaws.com` event for the denied resource and adjust `bedrock.allowedModelIds`/`allowedRegions` |
| `ValidationException ... on-demand throughput isn't supported` | the model must be called via an inference-profile id (`global.`/`us.`/`eu.` prefix) in your region                                                                                                                                                                                                       |
| `ThrottlingException` / `rate_limited`                         | Service Quotas -> Bedrock (per model, per region; embeddings are RPM-limited); request an increase; reduce `WORKER_CONCURRENCY` for ingestion                                                                                                                                                            |
| Health check red in Settings -> AI                             | the stored `lastHealthError` holds the AWS message; `CredentialsProviderError` = no AWS identity available to the process (locally: `aws sso login`; in AWS: task role missing)                                                                                                                          |
| Provider unavailable in Settings                               | `AI_BEDROCK_ENABLED` is false on the API                                                                                                                                                                                                                                                                 |

## 9. Access the database for debugging (no bastion)

Dev/staging have ECS Exec enabled. Requires the Session Manager plugin locally.

```bash
TASK=$(aws ecs list-tasks --cluster $CLUSTER --service-name hilatech-$ENV-api --query 'taskArns[0]' --output text)
RUNTIME=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $TASK --query 'tasks[0].containers[?name==`api`].runtimeId | [0]' --output text)
DBHOST=$(aws cloudformation describe-stacks --stack-name HilaTech-$ENV-Data --query "Stacks[0].Outputs[?OutputKey=='DbEndpoint'].OutputValue" --output text)
aws ssm start-session --target "ecs:${CLUSTER}_$(basename $TASK)_${RUNTIME}" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$DBHOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"5433\"]}"
# in another shell: password from Secrets Manager, then psql "host=localhost port=5433 dbname=hilatech user=hilatech sslmode=require"
```

Prod has ECS Exec disabled by design; use a snapshot restore for investigation instead.

## 10. Incident template

Impact, start/detect/resolve times, timeline, root cause, what went well/badly, action items with owners. Store in the
repository `docs/operations/incidents/`.
