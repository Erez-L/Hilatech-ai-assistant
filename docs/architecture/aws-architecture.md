# AWS architecture

**Status: designed and synthesised, never deployed.** `infra/cdk` passes `cdk synth` (with cdk-nag) for dev, staging
and prod and has template-assertion tests, but no stack has ever been created in an AWS account. Everything below is
what the templates _will_ create; treat runtime behaviour as unverified until the first dev deploy
(see `docs/operations/aws-setup-guide.md`). Cost figures are intentionally absent: see `docs/operations/cost-model.md`.

Principle: **AWS-first, not AWS-locked.** The app still runs with Docker Compose and non-AWS providers; AWS appears
only as infrastructure (CDK), as the `bedrock` AI provider, and as the S3 storage driver that already existed.

## Topology

```
Internet
   |  HTTPS 443 (ACM cert) / HTTP 80 -> 301 to HTTPS
+--v---------------------------- public subnets (2 AZ) ---------------------------+
|  ALB  (+ WAFv2 REGIONAL in staging/prod)            NAT gateway(s) (dev: 1)       |
+--+--------------------------------------------------------------+---------------+
   | /api/*  -> api TG :4000        default -> web TG :3000        | egress only
+--v------------------------- private subnets "app" (2 AZ) -------------------------v--+
|  ECS Fargate: api (N tasks)   web (N tasks)   workers (N tasks, no inbound)           |
|  one-off task: migrate (prisma migrate deploy)                                         |
+--+----------------------------------+------------------+------------------------------+
   | 5432 (TLS)                       | 6379 (TLS+AUTH)  | HTTPS to AWS APIs
+--v------- isolated subnets "data" ---v----+             +-> S3 (gateway endpoint)  -> documents bucket
|  RDS PostgreSQL 16 (pgvector)  ElastiCache |             +-> Bedrock Runtime (NAT, or interface endpoint in prod)
|  Redis 7 (BullMQ, noeviction)              |             +-> Secrets Manager, ECR, CloudWatch Logs
+--------------------------------------------+
```

One public hostname serves everything: the ALB routes `/api/*` to the API and everything else to Next.js. The web
image is built with `NEXT_PUBLIC_API_URL` = the same origin (no CORS surprises, cookies stay first-party).

## Stacks (`infra/cdk`)

| Stack                    | Contents                                                                                                                                                                                                                                                                                                                          | Why separate                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `HilaTech-<env>-Network` | VPC 10.40.0.0/16, 2 AZ; subnets: public / private-with-egress ("app", /22) / isolated ("data"); NAT gateways (dev 1, staging 1, prod 2); S3 gateway endpoint; optional interface endpoints (ECR api+dkr, Logs, Secrets Manager, Bedrock Runtime - prod only by default); REJECT flow logs (staging/prod); **all security groups** | SGs live here so cross-stack rules cannot form dependency cycles |
| `-Registry`              | 3 ECR repos (`hilatech-<env>/api                                                                                                                                                                                                                                                                                                  | web                                                              | workers`), scan on push, keep last 20, prod = immutable tags | Must exist before images are pushed; deploy first |
| `-Data`                  | RDS PostgreSQL, ElastiCache Redis (or external-Redis secret), documents S3 bucket (+ access-logs bucket in staging/prod), Secrets Manager secrets, AWS Backup                                                                                                                                                                     | Stateful: app deploys can never replace it                       |
| `-App`                   | ECS cluster, ALB + listeners, WAF, 3 services with separate autoscaling, task roles, log groups, migrate task definition                                                                                                                                                                                                          | Stateless and replaceable                                        |
| `-Ops`                   | SNS alarm topic, 15 CloudWatch alarms in prod (fewer when Redis is external), dashboard, AWS Budgets                                                                                                                                                                                                                              | Depends on App+Data                                              |

## Per-environment sizing (starting points, not load-tested)

Source of truth: `infra/cdk/lib/config.ts`. Dev is deliberately tiny; staging mirrors prod's _shape_ at lower cost.

| Setting                                           | dev                              | staging                           | prod                                            |
| ------------------------------------------------- | -------------------------------- | --------------------------------- | ----------------------------------------------- |
| NAT gateways                                      | 1                                | 1                                 | 2 (one per AZ)                                  |
| Interface VPC endpoints                           | no                               | no                                | yes (ECR, Logs, Secrets, Bedrock)               |
| RDS class / storage / Multi-AZ                    | t4g.micro / 20 GiB (max 50) / no | t4g.small / 20 GiB (max 100) / no | t4g.medium / 50 GiB (max 500) / **yes**         |
| RDS deletion protection, retained on stack delete | no                               | yes                               | yes                                             |
| RDS automated backup retention                    | 1 day                            | 7 days                            | 14 days                                         |
| Redis                                             | cache.t4g.micro, 1 node          | cache.t4g.small, 1 node           | cache.t4g.small, primary + 1 replica (failover) |
| api / workers task size                           | 0.25 vCPU / 512 MiB              | 0.5 vCPU / 1 GiB                  | 1 vCPU / 2 GiB                                  |
| web task size                                     | 0.25 vCPU / 512 MiB              | 0.25 vCPU / 512 MiB               | 0.5 vCPU / 1 GiB                                |
| Task count min-max (each service)                 | 1-2                              | 1-3                               | 2-10                                            |
| CPU target tracking                               | 65%                              | 60%                               | 55%                                             |
| WAF                                               | off                              | on                                | on                                              |
| AWS Backup plan                                   | off (RDS native backups only)    | daily, 14 d                       | daily 35 d + monthly 365 d                      |
| Container Insights / ECS Exec                     | off / on                         | off / on                          | on / **off**                                    |
| Log retention                                     | 14 d                             | 30 d                              | 90 d                                            |
| Budget (placeholder limit, your tolerance)        | 100 USD                          | 300 USD                           | 1000 USD                                        |

The budget limits are _alert thresholds you should overwrite_, not estimates of what the stack costs.

## Services

| Service                 | Port | Health                                          | Scaling                        | Notes                                                                                                         |
| ----------------------- | ---- | ----------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| api                     | 4000 | `GET /api/v1/health` (container + target group) | CPU target + memory target 75% | `TRUST_PROXY=true`, `COOKIE_SECURE=true`, 30 s stop timeout; ALB idle timeout 120 s for streamed AI responses |
| web                     | 3000 | `GET /` (200-399)                               | CPU target + memory target 75% | `NEXT_PUBLIC_*` are **baked at image build**                                                                  |
| workers                 | 4100 | container check `GET /health`                   | CPU target only                | BullMQ consumers; 60 s stop timeout lets jobs drain                                                           |
| migrate (task def only) | -    | exit code                                       | -                              | `prisma migrate deploy`; run by hand or by `deploy-aws.yml`; reaches PostgreSQL only                          |

**Queue-aware worker scaling is not built.** BullMQ queue depth lives in Redis and is not a CloudWatch metric;
CPU is a weak proxy. Add a small publisher of queue depth as a custom metric before relying on worker autoscaling.

## Secrets and configuration

| Name (Secrets Manager `hilatech/<env>/...`) | Source                                                                                                       | Notes                                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db-credentials`                            | RDS-generated user `hilatech`, URL-safe password                                                             | not injected into tasks directly                                                                                                                                                  |
| `database-url`                              | assembled by CloudFormation from the DB endpoint + password (`sslmode=no-verify`)                            | injected as `DATABASE_URL`                                                                                                                                                        |
| `jwt-access-secret`, `jwt-refresh-secret`   | generated, 64 chars                                                                                          | injected                                                                                                                                                                          |
| `credentials-encryption-key`                | **placeholder you must replace**: `openssl rand -base64 32`                                                  | placeholder fails the app's env validation, so the API crash-loops until set (fail closed). **Back it up**: losing it makes every stored organization AI credential unrecoverable |
| `redis-url`                                 | assembled from the ElastiCache endpoint + generated AUTH token (or a placeholder you set for external Redis) | `rediss://`                                                                                                                                                                       |
| `redis-auth-token`                          | generated                                                                                                    |                                                                                                                                                                                   |

Plain environment variables hold only non-secret config (URLs, bucket name, flags). No AWS access keys exist
anywhere: tasks use their IAM roles; the S3 driver and Bedrock adapter use the SDK default chain.

Known limitations of the secret handling (also listed as cdk-nag acknowledgements):

- `DATABASE_URL` uses `sslmode=no-verify`: connections are TLS-encrypted (`rds.force_ssl=1`) but the server
  certificate is not verified, because the RDS CA bundle is not in Node's trust store. Hardening: bundle the RDS
  global CA in the image and switch to `verify-full`. Whether the `pg` driver accepts exactly this URL form with
  Prisma's adapter is **unverified** - confirm during the first dev deploy (migrate task output).
- No automatic rotation. The DB password is baked into `database-url` at deploy time, so Lambda rotation would
  silently break the app. Rotation is a manual runbook until the app reads credentials from Secrets Manager itself.
- Changing a secret's value does **not** restart tasks; force a new deployment (see runbooks).

## IAM (least privilege) - self-review

Each workload has its own task role; the execution role (pull image, write logs, read _only its injected secrets_)
is separate and generated by CDK.

| Role                             | Allowed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiTaskRole`, `WorkersTaskRole` | `s3:GetObject/PutObject/DeleteObject/AbortMultipartUpload` on `<documents bucket>/*`; `s3:ListBucket` on the bucket; `bedrock:InvokeModel` + `bedrock:InvokeModelWithResponseStream` on explicit foundation-model ARNs for the allowed models in the allowed regions, on this account's inference-profile ARNs for geography profiles, and (for `global.` profiles) on region-wildcarded model ARNs **conditioned on** `bedrock:InferenceProfileArn` being this account's profile; ECS Exec (`ssmmessages:*`) in dev/staging only |
| `WebTaskRole`, `MigrateTaskRole` | nothing (web never calls AWS; migrate only needs the network path to Postgres)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Trust policy                     | `ecs-tasks.amazonaws.com` with `aws:SourceAccount` = this account                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Not granted anywhere: `bedrock:*`, `s3:*`, `secretsmanager:*`, `iam:*`, `Resource: "*"` (except the two AWS-mandated
cases below). A template test (`infra/cdk/test/stacks.test.ts`) asserts that Bedrock statements contain only the two
invoke actions and never a bare `*`, and that web/migrate roles carry no S3/Bedrock/Secrets permissions.

**cdk-nag (AwsSolutions pack) is enabled and clean for all three environments after reasoned acknowledgements**
(`infra/cdk/lib/nag-acknowledgements.ts`; each has a written reason, and conditional ones apply only to the
environments where they hold). The acknowledged exceptions are:

| Exception                                        | Reason                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| IAM5 `Resource::*` on execution roles            | `ecr:GetAuthorizationToken` has no resource-level permissions                                                       |
| IAM5 `Resource::*` on task roles in dev/staging  | ECS Exec needs it; disabled in prod                                                                                 |
| IAM5 `<bucket>/*`                                | object-level S3 actions need it; one specific bucket                                                                |
| IAM5 region-wildcard model ARN (global profiles) | global profiles route anywhere; constrained by the `InferenceProfileArn` condition. **Unverified against real IAM** |
| IAM4 AWS Backup managed policies                 | no customer-managed equivalent documented                                                                           |
| SMG4 (no secret rotation)                        | see above                                                                                                           |
| EC23 ALB open to the internet                    | intended; WAF in staging/prod                                                                                       |
| ECS2 env vars in task defs                       | non-secret config only (asserted by a test)                                                                         |
| RDS11, AEC5 default ports                        | isolated subnets + SG-only access                                                                                   |
| RDS3 / RDS10 / AEC4 / S1 / ELB2 / ECS4 / VPC7    | cost choices in dev (and single-AZ staging); each is conditional on the config flag                                 |

cdk-nag checks the _template_, not the account: it does not see SCPs, existing resources, or runtime behaviour.

## Storage

- Documents bucket: block all public access, SSE-S3, TLS-only bucket policy, versioning with non-current expiry,
  `BUCKET_OWNER_ENFORCED`. Dev: auto-deleted on stack destroy. Staging/prod: **retained** on destroy.
- Application uses `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`; no static keys (default chain). Whether
  `S3StorageDriver` resolves credentials from the task role without keys is expected from its implementation
  (credentials only set when keys are given) but **unverified live**.

## Queues: BullMQ stays on Redis; SQS migration path

BullMQ requires Redis and relies on `maxmemory-policy noeviction` (configured). SQS is _not_ used.
Migration path if Redis operations become a burden: (1) put the job-producing code behind a small `JobQueue` port
(`enqueue`, `schedule`, `process`); (2) implement it on SQS (standard queue + DLQ per queue; delayed jobs <=15 min
natively, longer via EventBridge Scheduler); (3) move repeatable/cron jobs (automation scheduler, webhook retries)
to EventBridge Scheduler; (4) dual-run behind a flag per queue. Costs: loss of BullMQ features the workers use
(priorities, rate limiting, flows) must be re-implemented. Not built; not recommended before there is a concrete need.

## Observability

- Logs: JSON (pino) to CloudWatch Logs groups `/hilatech/<env>/{api,web,workers,migrate}`; retention per env.
- Alarms (SNS topic, e-mail subscription if `alarmEmail` is set): ALB target 5xx, API p95 latency, unhealthy
  hosts (api, web), CPU and memory per service, RDS CPU / free storage / connections, Redis memory / engine CPU.
  Thresholds are placeholders - tune after observing real traffic.
- Dashboard `hilatech-<env>`: ALB, API latency, healthy hosts, ECS CPU/memory, RDS.
- Not built: custom app metrics (queue depth, AI token usage, per-tenant error rates), distributed tracing,
  synthetic canaries, CloudWatch Logs Insights saved queries, log-based alarms.

## Edge: WAF and CloudFront

- WAFv2 REGIONAL on the ALB in staging/prod: per-IP rate limit (2,000 / 5 min, a placeholder), AWS managed Common,
  Known-bad-inputs and IP-reputation groups. `SizeRestrictions_BODY` is set to _count_ so uploads and large AI
  payloads are not blocked at 8 KB - review sampled requests before changing any rule to block. No WAF logging yet.
- **CloudFront is not built.** A CloudFront distribution needs an origin-hostname/certificate design (the ALB cert
  covers the public name that would point at CloudFront) and a CLOUDFRONT-scope WAF in us-east-1. It is worth adding
  for static-asset caching and global latency, not for the first deploy.

## Backup and recovery

See `docs/operations/backup-recovery.md`. Summary: RDS automated backups (all envs) + AWS Backup plan for RDS and
the documents bucket (staging/prod); S3 versioning; Redis is reconstructible queue/cache state.

## Not built (explicit)

CloudFront and CloudFront-scope WAF; Route 53 records / hosted zone (bring your own DNS); SES e-mail (the stacks
set `EMAIL_DRIVER=log` - emails are only logged until you wire SMTP/SES); cross-region backup copy and DR region;
RDS Proxy; Aurora; blue/green or canary deployments (ECS rolling with circuit-breaker rollback only); queue-depth
autoscaling; secrets rotation; GuardDuty / Security Hub / Config; AWS Organizations / SCP guardrails; private
(PrivateLink) access to the ALB; per-tenant AWS isolation.

## Known unverified points to check at first deploy

1. `DATABASE_URL` with `sslmode=no-verify` works with the app's Prisma `pg` adapter.
2. The pgvector extension is available on the chosen RDS PostgreSQL 16 minor (the first migration runs
   `CREATE EXTENSION vector` and creates an HNSW index, which needs pgvector >= 0.5). The docs fetch for this was
   inconclusive; the setup guide has a check.
3. `migrate` task command path (`node_modules/prisma/build/index.js ... --config node_modules/@hilatech/database/prisma.config.ts`)
   matches the built API image (copied from `docker-compose.prod.yml`; the image was not built here).
4. Web health check `GET /` returns 200-399 without auth.
5. Bedrock IAM for inference profiles (see above), model ids, and region availability.
6. ElastiCache `AuthToken` + `rediss://:token@host` works with the Redis client the app uses.
7. Seeding the permission catalog (`pnpm db:seed`) in AWS: the production API image has no `tsx`/seed script; see the
   setup guide for the SSM port-forward approach, and check whether registration works without it.
