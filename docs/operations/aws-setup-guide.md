# AWS setup guide - connect HilaTech AI Assistant to AWS

For: the account owner (a senior developer who is new to AWS architecture). Goal: from zero AWS account to a
working **dev** environment (Bedrock-powered AI, deployed on ECS Fargate), safely and with control over cost.

> **Honesty box - read first.** This guide was written from AWS documentation and from the code in this repo. **No
> step here has been executed against a real AWS account** (the author had no credentials). The CDK app passes
> `cdk synth` and unit tests; the Bedrock adapter passes unit tests with a mocked client. Expect to hit small
> problems. Every step lists "What can go wrong"; when you find a wrong instruction, fix this file.
> Console screens change - names below are accurate as of the AWS docs consulted on 2026-11-10 but may move.

## Conventions

| Tag               | Meaning                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| **[FREE]**        | No charge expected.                                                                                               |
| **[SMALL COST]**  | Cents to a few dollars if you clean up the same day.                                                              |
| **[COSTS MONEY]** | Starts billing by the hour/GB until you delete it (NAT, RDS, ALB, Redis, Fargate...). Section 11 is the teardown. |
| `<PLACEHOLDER>`   | Replace with your own value. Everything else is copy-pasteable as-is in bash (macOS/Linux/WSL/Git Bash).          |

Total order: **A. Account safety (steps 1-4) -> B. Local tools (5-6) -> C. Region and Bedrock (7-8) -> D. Local dev with Bedrock
(9-10) -> E. Deploy dev (11-19) -> F. CI deploy (20) -> G. Operate and tear down (21-23).** You can stop after D and have a
fully working local setup that costs only Bedrock tokens.

Time estimate: A-D about 1-2 hours (plus waiting for emails/approvals), E about 2-3 hours the first time.

---

## A. Create and secure the account (do all of this BEFORE creating any resource)

### Step 1 - Create the AWS account [FREE]

1. Go to https://aws.amazon.com/ -> **Create an AWS Account**. Use a **company mailbox you will keep**
   (e.g. `aws-root@your-domain`), not a personal one. Account name: `hilatech`.
2. Add a payment card, verify the phone number, choose the **Basic support** (free) plan.
3. Sign in as **Root user** with that e-mail.

_Expected:_ you land on the AWS console home. _Can go wrong:_ card verification failures (use a card that allows
online/international payments); account activation can take a few minutes up to a day - wait for the "welcome" e-mail.

### Step 2 - Lock down the root user [FREE]

1. Console (top-right account menu) -> **Security credentials** -> **Multi-factor authentication (MFA)** -> **Assign MFA device**.
   Prefer a **passkey/security key**; an authenticator app is fine. Register **two** MFA devices if offered, and store recovery info offline.
2. Do **not** create root access keys (leave "Access keys" empty).
3. From now on **never use root** except for the few root-only tasks (changing support plan, closing the account).

_Expected:_ "MFA device: assigned" in Security credentials. _Can go wrong:_ losing the MFA device without a second one means a
recovery process through AWS support - register two devices now.

### Step 3 - Budget alerts FIRST [FREE]

1. Console search -> **Billing and Cost Management** -> left menu **Budgets** -> **Create budget**.
2. Choose **Use a template (simplified)** -> **Monthly cost budget**. Name `account-monthly`.
   Amount: **your own tolerance** (start low, e.g. what you would be unhappy to be surprised by). E-mail recipients: your address. **Create budget**.
3. Left menu **Billing preferences**: tick **Receive AWS Free Tier alerts** and **Receive PDF invoice by email** (optional) -> **Save**.
4. **Account settings** (account menu) -> scroll to **IAM user and role access to Billing information** -> **Edit** -> **Activate IAM Access** -> Update.
   (Without this, your administrator user in step 4 cannot see billing.)
5. Left menu **Cost Anomaly Detection** -> create a monitor for "AWS services" with an e-mail alert (free).

_Expected:_ a budget listed with status "OK". _Can go wrong:_ Budgets are **warnings, not limits** and cost data lags by
hours - a budget will not stop a runaway resource. The CDK stacks add a second, per-environment budget later (step 16).

### Step 4 - IAM Identity Center and an admin user (no IAM users, no long-lived keys) [FREE]

1. Console -> choose your **home region** (see step 7 - for Identity Center it is hard to change later; pick the region you will use most).
2. Search **IAM Identity Center** -> **Enable**. (If asked: enable with **AWS Organizations**; your account becomes the organization's management account. This is free.)
3. **Settings** -> **Authentication** -> **Configure** MFA: "Every time they sign in", authenticator apps/security keys allowed.
4. **Users** -> **Add user**: your name and e-mail (`erez@...`). You will get an invitation e-mail - accept it, set a password, register MFA.
5. **Permission sets** -> **Create permission set** -> **Predefined** -> `AdministratorAccess`, session duration 4 hours. (For a solo dev account this is acceptable; later split into least-privilege roles for CI/other people.)
6. **AWS accounts** -> select your account -> **Assign users or groups** -> your user -> permission set `AdministratorAccess` -> Submit.
7. Note the **AWS access portal URL** (Identity Center dashboard), like `https://d-xxxxxxxxxx.awsapps.com/start`.

_Expected:_ opening the portal URL shows your account with an `AdministratorAccess` link. _Can go wrong:_ the invitation
e-mail lands in spam; the portal URL is region-specific; if you pick a region without the services you need, remember Identity Center's
region does not constrain where you deploy workloads.

---

## B. Local tools

### Step 5 - Install tooling [FREE]

You need: Node 22+, pnpm 10+, Docker, git, `jq`, and **AWS CLI v2**, plus the **Session Manager plugin** (only for step 22 debugging).

```bash
# AWS CLI v2 - Linux x86_64 (macOS: `brew install awscli`; Windows: the MSI installer)
curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q -o /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install --update
aws --version        # expect: aws-cli/2.x
# jq: sudo apt-get install -y jq   |   brew install jq
```

Session Manager plugin: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html

_Can go wrong:_ an old AWS CLI v1 first on `PATH` (`which -a aws`). Bedrock model-access CLI commands need a recent v2 (the AWS docs mention 2.27.42 or later).

### Step 6 - Log in from the CLI with SSO [FREE]

```bash
aws configure sso
# SSO session name:        hilatech
# SSO start URL:           <YOUR ACCESS PORTAL URL from step 4>
# SSO region:              <home region where you enabled Identity Center>
# SSO registration scopes: sso:account:access   (press Enter for the default)
# -> a browser opens; approve. Then choose your account + AdministratorAccess.
# Default client Region:   <the region you will deploy to, see step 7>
# CLI default output:      json
# Profile name:            hilatech-dev
aws sso login --profile hilatech-dev
export AWS_PROFILE=hilatech-dev
aws sts get-caller-identity
```

_Expected:_ JSON with your `Account` id and an `Arn` containing `AWSReservedSSO_AdministratorAccess`.
_Can go wrong:_ `The SSO session associated with this profile has expired` -> run `aws sso login --profile hilatech-dev` again
(sessions last hours; you will do this often). Browser on a remote machine: add `--no-browser`.

---

## C. Pick a region and enable Bedrock

### Step 7 - Choose the region [FREE]

Decide **one** region for dev. Criteria, in order: (1) the Bedrock models you want are available there, (2) data
residency / privacy needs (EU customers -> an EU region), (3) latency to users, (4) price (varies by region - use the
Pricing Calculator). Two practical defaults: `us-east-1` (widest model availability, usually cheapest) or
`eu-central-1` (EU residency, close to Israel). I could **not verify** which models exist in which region (the
docs moved that table into per-model pages), so check with your own account:

```bash
export AWS_REGION=<REGION, e.g. us-east-1>
# Foundation models that can be called on-demand in this region:
aws bedrock list-foundation-models --region $AWS_REGION \
  --query 'modelSummaries[].{id:modelId,provider:providerName,io:outputModalities[0],inference:inferenceTypesSupported}' --output table
# Cross-region / global inference profiles available to you (newer Claude models usually need one of these ids):
aws bedrock list-inference-profiles --region $AWS_REGION \
  --query 'inferenceProfileSummaries[].inferenceProfileId' --output text | tr '\t' '\n' | sort
```

Write down: one cheap chat model id (e.g. an Amazon Nova model), one Claude id if you want Claude, and
`amazon.titan-embed-text-v2:0` for embeddings. **Use the ids exactly as printed here**, not the ids in this repo's
registry, which are unverified.

_Expected:_ tables of model ids. _Can go wrong:_ `AccessDeniedException` -> your profile lacks Bedrock permissions
(Administrator has them); empty list -> Bedrock unavailable in that region, choose another.

If you choose a region other than `us-east-1`, set it everywhere consistently: `AWS_REGION`, the CLI profile default,
and CDK (`CDK_DEFAULT_REGION` is picked up from your profile automatically).

### Step 8 - Get access to Bedrock models [SMALL COST - you pay per token]

In commercial regions most models are enabled on first use; **Anthropic (Claude) models need a one-time first-use form**.

1. Console -> **Amazon Bedrock** (check the region selector top-right) -> **Model catalog** -> open an **Anthropic** model
   -> complete the **use case details** form (company/project description and a website - a personal portfolio, GitHub
   or project URL is accepted per the AWS docs). Submit.
2. Check the status (replace `<MODEL_ID>` with an id from step 7):

```bash
aws bedrock get-foundation-model-availability --model-id <MODEL_ID> --region $AWS_REGION \
  --query 'agreementAvailability.status' --output text      # AVAILABLE | PENDING | NOT_AVAILABLE | ERROR
```

3. Prove a real call works from the CLI (tiny cost). For a Nova/Claude model that supports Converse:

```bash
aws bedrock-runtime converse --region $AWS_REGION --model-id <CHAT_MODEL_OR_PROFILE_ID> \
  --messages '[{"role":"user","content":[{"text":"Say hello in five words."}]}]' \
  --inference-config '{"maxTokens":50}' --query 'output.message.content[0].text' --output text
```

4. Prove embeddings work:

```bash
aws bedrock-runtime invoke-model --region $AWS_REGION --model-id amazon.titan-embed-text-v2:0 \
  --content-type application/json --cli-binary-format raw-in-base64-out \
  --body '{"inputText":"hello","dimensions":1024,"normalize":true}' /tmp/titan.json
jq '{dims: (.embedding|length), tokens: .inputTextTokenCount}' /tmp/titan.json     # expect dims 1024
```

_Expected:_ a short sentence; `dims: 1024`. _Can go wrong:_

- `AccessDeniedException ... status PENDING` -> the Anthropic form is still processing; wait and re-check.
- Access may take up to ~15 minutes after first use to be provisioned.
- `ValidationException: ... on-demand throughput isn't supported` -> that model needs an **inference profile id** (`global.`/`us.`/`eu.` prefix) - use an id from `list-inference-profiles`.
- `ThrottlingException` on a brand-new account -> low default quotas (Service Quotas console -> Amazon Bedrock).
- Quota/limits to review now: see `docs/architecture/aws-capability-matrix.md` section 4.

---

## D. Local development with Bedrock (no AWS resources created)

### Step 9 - Configure the app to use your SSO profile [SMALL COST - tokens only]

The Bedrock adapter has **no API key**. It uses the AWS SDK's default credential chain, so locally it uses your SSO profile.

1. Start the local stack as usual (see `docs/development/setup.md`): `docker compose up -d postgres redis`, `pnpm install`, `pnpm db:generate`, `pnpm db:migrate:dev`, `SEED_DEMO=true pnpm db:seed`.
   **The database needs the migration `20261110090000_bedrock_provider`** (adds `bedrock` and the `region` column) - `pnpm db:migrate:dev` applies it.
2. Add to your local `.env` (copy of `.env.example`):

```bash
AI_BEDROCK_ENABLED=true
AWS_PROFILE=hilatech-dev
AWS_REGION=<REGION from step 7>
```

3. Make sure your SSO session is live, then start the app:

```bash
aws sso login --profile hilatech-dev
pnpm dev
```

(Turbo is configured to pass `AWS_PROFILE`/`AWS_REGION` through; the API and workers also read them from `.env`.)

_Expected:_ API on :4000, web on :3000, no AWS errors at startup (the SDK resolves credentials lazily on the first Bedrock call).
_Can go wrong:_ credentials are only resolved when the first request is made - an expired SSO session shows up then, not at boot
(re-run `aws sso login`). `AI_BEDROCK_ENABLED=false` makes the provider disappear from Settings.

### Step 10 - Add the Bedrock provider in the web app [SMALL COST - tokens only]

1. Open http://localhost:3000, log in (`owner@demo.local` / `DemoPassw0rd!` with the demo seed).
2. **Settings -> AI** -> **Add provider**.
3. **Provider:** `Amazon Bedrock`. **Name:** `Bedrock dev`. **AWS region:** your region (or blank to use `AWS_REGION`).
   There is **no API key field** (by design) and no Base URL field. **Default model:** type the **exact** chat model or
   inference-profile id you verified in steps 7-8 (the box offers suggestions from the built-in catalogue, which is labelled
   "unverified availability - check your region"; the box accepts any text). **Embedding model:** `amazon.titan-embed-text-v2:0`.
   Turn on **Use as the default provider**. **Add provider**.
4. In the providers table click **Check** on the new row.

_Expected:_ health badge turns **healthy** with a latency in ms.
_Can go wrong / notes:_

- **Model not offered as a suggestion:** harmless; type the id. Context-window budgeting falls back to a 128k default for ids that are not in `packages/ai-engine/src/providers/models.ts`, and `AI_PRICING_JSON` is keyed by the exact id you typed.
- Badge **error** with `AWS credentials could not be resolved` -> SSO session expired or `AWS_PROFILE` not set for the API process.
- `AccessDeniedException` -> Anthropic form pending, model not enabled in this region, or the id needs an inference profile.
- Provider missing from the dropdown / "Amazon Bedrock is not enabled on this server" -> `AI_BEDROCK_ENABLED=true` was not applied (restart the API).
- Test a real chat in the Assistant page, and ingest a small text document into a knowledge base to exercise embeddings
  (Titan vectors are 1,024-dim and are zero-padded to the app's 1,536 - expected).
- Cost: set a **small `maxTokens`** while testing; watch **Settings -> Billing/usage** in the app and `AI_PRICING_JSON` for estimates.

---

## E. Deploy the dev environment to AWS [COSTS MONEY from step 13 onward]

Everything below uses `infra/cdk`. Nothing deploys unless you run `cdk deploy` yourself.
Review the plan: `docs/architecture/aws-architecture.md` (what is created) and `docs/operations/cost-model.md` (what drives the bill).

```bash
cd infra/cdk
npm ci
export AWS_PROFILE=hilatech-dev AWS_REGION=<REGION>
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export ENV=dev
export DOMAIN=<app-dev.your-domain.com>      # the public hostname you will point at the ALB (step 15)
export ALARM_EMAIL=<you@your-domain.com>
```

### Step 11 - Choose a domain and request a TLS certificate [FREE]

The API sets `Secure` cookies in production mode, so **login only works over HTTPS** - a certificate is required for a usable environment.

1. Console -> **Certificate Manager (ACM)** -> **in your deployment region** -> **Request** -> public certificate -> domain `${DOMAIN}` -> **DNS validation** -> Request.
   (Or CLI: `aws acm request-certificate --domain-names "$DOMAIN" --validation-method DNS --region $AWS_REGION`.)
2. Open the certificate, copy the **CNAME name/value** and create that record at your DNS provider (Route 53, Cloudflare, your registrar...). If the DNS is not in Route 53, this is manual.
3. Wait until **Status: Issued** (minutes). Save the ARN:

```bash
export CERT_ARN=$(aws acm list-certificates --region $AWS_REGION \
  --query "CertificateSummaryList[?DomainName=='${DOMAIN}'].CertificateArn | [0]" --output text)
echo "$CERT_ARN"
```

_Can go wrong:_ certificate stuck in "Pending validation" -> the CNAME was entered with your domain suffix duplicated
(many DNS UIs append the zone automatically) or at the wrong zone. The certificate must be in the **same region** as the ALB.

### Step 12 - Bootstrap CDK (once per account+region) [SMALL COST]

Creates the `CDKToolkit` stack (an S3 bucket, an ECR repo for assets, and IAM roles CDK assumes when deploying).

```bash
npx cdk bootstrap "aws://${ACCOUNT}/${AWS_REGION}"
```

_Expected:_ `Environment aws://.../... bootstrapped`. _Can go wrong:_ `Need to perform AWS calls ... no credentials` ->
`aws sso login`; a first bootstrap needs IAM permissions (Administrator is fine). Bootstrap is **not** per environment.

Preview what dev will create (still free, nothing is created):

```bash
npx cdk synth -c env=$ENV --quiet && echo synth-ok
npx cdk diff HilaTech-$ENV-Network -c env=$ENV      # diff reads the account; creates nothing
```

### Step 13 - Deploy network, registry and data [COSTS MONEY]

This creates the VPC with one NAT gateway, ECR repositories, RDS PostgreSQL, ElastiCache Redis, the S3 bucket and secrets.
**From this moment the clock runs** (NAT, RDS, Redis bill by the hour).

```bash
npx cdk deploy HilaTech-$ENV-Network HilaTech-$ENV-Registry HilaTech-$ENV-Data \
  -c env=$ENV -c alarmEmail="$ALARM_EMAIL"
```

CDK shows an IAM/security-group change table and asks `Do you wish to deploy these changes (y/n)?` -> review, answer `y`.
RDS creation takes roughly 5-15 minutes.

_Expected:_ three `✅` stacks, outputs `DbEndpoint`, `DocumentsBucketName`, `CredentialsKeySecretName`, ECR repo URIs.
_Can go wrong:_

- `...secret with this name is scheduled for deletion` -> a previous destroy left secrets in the recovery window; see teardown step 23.
- Quota errors (Elastic IP limit, VPC limit) -> Service Quotas.
- `The specified engine version ... not available` -> your region lacks that Postgres minor; change `PostgresEngineVersion` in `lib/stacks/data-stack.ts`.
- Interrupted deploy: re-run the same command; CloudFormation resumes or rolls back (a failed first create stays in `ROLLBACK_COMPLETE` and must be deleted before retrying: `aws cloudformation delete-stack --stack-name <name>`).

### Step 14 - Set the required secrets [FREE]

The encryption key for stored org AI credentials cannot be generated by Secrets Manager, so the stack creates a
**placeholder that makes the app refuse to start** until you replace it.

```bash
aws secretsmanager put-secret-value --secret-id hilatech/$ENV/credentials-encryption-key \
  --secret-string "$(openssl rand -base64 32)"
```

**Back this value up now** (password manager): `aws secretsmanager get-secret-value --secret-id hilatech/$ENV/credentials-encryption-key --query SecretString --output text`.
If it is lost, every stored organization AI credential becomes unreadable (backups included).

_Can go wrong:_ `openssl` missing on Windows (use Git Bash/WSL). The JWT secrets and Redis token are generated for you.

### Step 15 - Build and push the container images to ECR [SMALL COST]

```bash
cd ../..          # repo root
export TAG=$(git rev-parse --short HEAD)       # any unique tag; do not use a tag you will overwrite in prod (prod ECR tags are immutable)
export REGISTRY="${ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin "$REGISTRY"

# ECS tasks are configured for linux/amd64 (Apple Silicon: the --platform flag is required)
for svc in api workers; do
  docker build --platform linux/amd64 -f infrastructure/docker/${svc}.Dockerfile \
    -t "${REGISTRY}/hilatech-${ENV}/${svc}:${TAG}" . && docker push "${REGISTRY}/hilatech-${ENV}/${svc}:${TAG}"
done
# web: NEXT_PUBLIC_* are baked in at BUILD time -> they must be your final public URL (same origin for web and API)
docker build --platform linux/amd64 -f infrastructure/docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL="https://${DOMAIN}" --build-arg NEXT_PUBLIC_APP_URL="https://${DOMAIN}" \
  -t "${REGISTRY}/hilatech-${ENV}/web:${TAG}" . && docker push "${REGISTRY}/hilatech-${ENV}/web:${TAG}"
```

_Expected:_ three pushed images; check with `aws ecr describe-images --repository-name hilatech-$ENV/api --region $AWS_REGION`.
_Can go wrong:_ build failures are the repo's Dockerfiles, not AWS (they were not built while writing this guide) - fix and retry;
`no basic auth credentials` -> the login token expired (valid 12 hours) -> repeat the `docker login`; slow upload on a weak connection.
Changing the domain later means **rebuilding the web image**.

### Step 16 - Deploy the application stack (paused), then migrate [COSTS MONEY]

Deploy with services paused (0 tasks) so nothing starts before the database has its schema:

```bash
cd infra/cdk
npx cdk deploy HilaTech-$ENV-App HilaTech-$ENV-Ops \
  -c env=$ENV -c imageTag=$TAG -c certificateArn="$CERT_ARN" -c domainName="$DOMAIN" \
  -c alarmEmail="$ALARM_EMAIL" -c pauseServices=true
```

This also creates the dashboard, alarms (SNS e-mail subscription: **confirm the e-mail AWS sends**) and a per-environment AWS Budget.

Now run the migrations (one-off Fargate task):

```bash
export CLUSTER=hilatech-$ENV
OUT=$(aws cloudformation describe-stacks --stack-name HilaTech-$ENV-App --query 'Stacks[0].Outputs' --output json)
get() { echo "$OUT" | jq -r ".[] | select(.OutputKey==\"$1\").OutputValue"; }
TASK_ARN=$(aws ecs run-task --cluster $CLUSTER --task-definition "$(get MigrateTaskDefinition)" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$(get MigrateSubnets)],securityGroups=[$(get MigrateSecurityGroup)],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
echo "$TASK_ARN"
aws ecs wait tasks-stopped --cluster $CLUSTER --tasks "$TASK_ARN"
aws ecs describe-tasks --cluster $CLUSTER --tasks "$TASK_ARN" --query 'tasks[0].containers[0].{exit:exitCode,reason:reason}'
aws logs tail /hilatech/$ENV/migrate --since 15m
```

_Expected:_ `exit: 0` and the log listing the applied migrations (including `20261110090000_bedrock_provider`).
_Can go wrong (likely candidates, none verified yet):_

- `extension "vector" is not available` -> pgvector missing on that RDS PostgreSQL minor; choose a newer minor in `data-stack.ts` and redeploy Data (it will update/replace per CloudFormation rules - on a new dev DB that is acceptable).
- `Cannot find module` / `prisma: not found` -> the image is older than 2026-11-12. The migrate task runs `node node_modules/prisma/build/index.js migrate deploy` in `/app/migrate`, a bundle that `infrastructure/docker/api.Dockerfile` now builds into the API image; CI runs exactly this command from the built image against PostgreSQL on every push. Rebuild and push the API image.
- `Failed to fetch ... binaries.prisma.sh` -> the task has no internet egress (the Prisma schema engine is fetched on first use if it was not baked in at build time): check the NAT gateway and the `MigrateSg` egress rule.
- `self-signed certificate in certificate chain` / SSL errors -> the `sslmode=no-verify` DATABASE_URL form is not honoured by the driver; see "Known unverified points" in `aws-architecture.md`.
- Task cannot start / `ResourceInitializationError` -> it could not pull the image or read secrets: check NAT gateway exists, `credentials-encryption-key` is set (not needed by migrate, but others are), and the image tag exists in ECR.
- Timeout connecting to the DB -> security group rules (should allow `MigrateSg`->`DbSg:5432`).

### Step 17 - Start the services [COSTS MONEY]

Redeploy **without** `pauseServices`:

```bash
npx cdk deploy HilaTech-$ENV-App -c env=$ENV -c imageTag=$TAG -c certificateArn="$CERT_ARN" \
  -c domainName="$DOMAIN" -c alarmEmail="$ALARM_EMAIL"
aws ecs wait services-stable --cluster $CLUSTER \
  --services hilatech-$ENV-api hilatech-$ENV-web hilatech-$ENV-workers
```

_Expected:_ each service `runningCount == desiredCount` (1/1/1). _Can go wrong:_

- Tasks restart in a loop -> `aws ecs describe-tasks ...` on the stopped tasks, then `aws logs tail /hilatech/$ENV/api --since 15m`.
  Most common: a secret still a placeholder, wrong image tag, a missing env var rejected by the env schema (the log names it).
- Targets "unhealthy" -> web health path `/` or API `/api/v1/health` not 200; check the target group health reason in the console (EC2 -> Target groups).
- If you used `-c pauseServices=true` once, **remember to drop it** (paused services have no autoscaling).

### Step 18 - Point your domain at the load balancer [FREE]

```bash
aws cloudformation describe-stacks --stack-name HilaTech-$ENV-App \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" --output text
```

At your DNS provider create a **CNAME** `${DOMAIN}` -> that ALB DNS name (Route 53 users: an alias A record to the ALB).
_Expected after DNS propagation (minutes):_ `curl -sS https://$DOMAIN/api/v1/health` returns a JSON `status: ok`.
_Can go wrong:_ certificate name mismatch (the cert must be for exactly `$DOMAIN`); Cloudflare proxy "orange cloud" enabled with strict SSL needs extra
setup (start with DNS-only/grey cloud); stale DNS cache.

### Step 19 - Smoke tests [SMALL COST]

```bash
curl -fsS https://$DOMAIN/api/v1/health            # liveness
curl -fsS https://$DOMAIN/api/v1/health/ready      # database + redis
curl -fsSI https://$DOMAIN/ | head -1              # web: HTTP/2 200
```

Then in the browser at `https://$DOMAIN`:

1. **Register** a new account/organization. (E-mails are only **logged** - `EMAIL_DRIVER=log`; if verification is required, take the link from
   `aws logs tail /hilatech/$ENV/api --since 10m --filter-pattern verify`. SES/SMTP is not wired by the stacks.)
2. **Settings -> AI -> Add provider -> Amazon Bedrock**; region = the stack region; models as verified in step 8; click **Check** -> healthy.
   This uses the **task role**, not your SSO profile - a failure here with `AccessDenied` means an IAM/model-id mismatch (see runbooks section 8).
3. Send a message in the **Assistant**; upload a small document to a knowledge base and search it (exercises S3, workers, Redis, embeddings).
4. CloudWatch -> Dashboards -> `hilatech-dev`: traffic should appear. Check no alarm is firing.

**Permission catalog:** no seed step is needed. Since 2026-11-12 the API upserts the `Permission` catalog from `@hilatech/contracts` every time it starts (verified by the CI container smoke test, which registers a user and creates an organization on a freshly migrated database). Never run the demo seed (`SEED_DEMO=true`) against a shared environment.

**Email:** the stack sets `EMAIL_DRIVER=log`, so verification, reset and invitation emails are only written to the worker log. Keep `REQUIRE_EMAIL_VERIFICATION=false` (the default) until SMTP/SES is wired; with it on and no delivery, new users cannot get past the verification screen.

_If everything above works you have a functioning dev environment._ Leave it running only as long as you need it (cost) - see step 23.

---

## F. CI/CD deployment with GitHub OIDC (optional, later)

### Step 20 - Create the GitHub OIDC deploy role [FREE]

The `deploy-aws.yml` workflow (**disabled by default**) assumes an AWS role through OpenID Connect - no AWS keys are stored in GitHub.
The IAM policy below is a **starting point I could not test**; tighten and verify before trusting it with production.

```bash
export GH_OWNER=<github-user-or-org> GH_REPO=hilatech-ai-assistant
# 1) One-time OIDC provider for GitHub Actions (skip if it already exists in the account)
aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1     # AWS ignores thumbprints for GitHub's OIDC provider; value is required by the CLI

# 2) Trust policy: ONLY this repo, ONLY the GitHub Environment aws-dev (which has required reviewers)
cat > /tmp/trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:${GH_OWNER}/${GH_REPO}:environment:aws-dev"
      }
    }
  }]
}
EOF
aws iam create-role --role-name hilatech-github-deploy-dev --assume-role-policy-document file:///tmp/trust.json \
  --max-session-duration 3600

# 3) Permissions: assume the CDK bootstrap roles, push to this env's ECR repos, run the migration task, read stack outputs
cat > /tmp/perms.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Sid":"CdkBootstrapRoles","Effect":"Allow","Action":"sts:AssumeRole",
     "Resource":"arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-*-role-${ACCOUNT}-${AWS_REGION}"},
    {"Sid":"EcrLogin","Effect":"Allow","Action":"ecr:GetAuthorizationToken","Resource":"*"},
    {"Sid":"EcrPush","Effect":"Allow","Action":["ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:PutImage","ecr:BatchGetImage","ecr:DescribeImages"],
     "Resource":"arn:aws:ecr:${AWS_REGION}:${ACCOUNT}:repository/hilatech-dev/*"},
    {"Sid":"MigrateTask","Effect":"Allow","Action":["ecs:RunTask","ecs:DescribeTasks","ecs:DescribeTaskDefinition"],"Resource":"*"},
    {"Sid":"PassTaskRoles","Effect":"Allow","Action":"iam:PassRole","Resource":"arn:aws:iam::${ACCOUNT}:role/HilaTech-dev-App-*",
     "Condition":{"StringEquals":{"iam:PassedToService":"ecs-tasks.amazonaws.com"}}},
    {"Sid":"ReadOutputs","Effect":"Allow","Action":["cloudformation:DescribeStacks"],"Resource":"arn:aws:cloudformation:${AWS_REGION}:${ACCOUNT}:stack/HilaTech-dev-*/*"}
  ]
}
EOF
aws iam put-role-policy --role-name hilatech-github-deploy-dev --policy-name deploy --policy-document file:///tmp/perms.json
echo "arn:aws:iam::${ACCOUNT}:role/hilatech-github-deploy-dev"
```

4. In GitHub: repo **Settings -> Environments** -> create `aws-dev` (and `aws-staging`, `aws-prod`) with **Required reviewers** (this is the manual approval gate).
5. Set the variables (once the role exists), with the GitHub CLI:

```bash
gh variable set AWS_DEPLOY_ENABLED --body true
gh variable set AWS_REGION --body "$AWS_REGION"
gh variable set AWS_DEPLOY_ROLE_ARN --body "arn:aws:iam::${ACCOUNT}:role/hilatech-github-deploy-dev"
gh variable set CERTIFICATE_ARN --body "$CERT_ARN"
gh variable set DOMAIN_NAME --body "$DOMAIN"
gh variable set ALARM_EMAIL --body "$ALARM_EMAIL"
gh variable set PUBLIC_API_URL --body "https://$DOMAIN"
gh variable set PUBLIC_APP_URL --body "https://$DOMAIN"
```

6. Run **Actions -> Deploy to AWS -> Run workflow** (environment `dev`, type `DEPLOY`), approve in the Environment gate.

_Can go wrong:_ `Not authorized to perform sts:AssumeRoleWithWebIdentity` -> the `sub` condition does not match (the claim for a job using
`environment: aws-dev` is `repo:OWNER/REPO:environment:aws-dev`); `AccessDenied` on `iam:PassRole`/CloudFormation during `cdk deploy` -> CDK uses the
bootstrap roles (the first statement) - make sure the bootstrap qualifier is the default `hnb659fds`; with a customised bootstrap, change the role ARNs. The
`iam:PassRole` resource pattern is a guess at CDK's generated role names - widen it to what the error message names. **The workflow and this policy have never run.**
This role can deploy infrastructure: never reuse it for prod (create a separate role bound to `environment:aws-prod`).

---

## G. Operate and tear down

### Step 21 - What to watch (costs and health) [FREE]

| Where                                                                   | What                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Billing -> **Cost Explorer** (enable it once; data appears after ~24 h) | daily cost, group by **Service**; look for: NAT Gateway, RDS, ElastiCache, ELB, EC2-Other (NAT data/EIP), Bedrock, CloudWatch |
| Billing -> Cost allocation tags                                         | activate tags `app` and `env` so the stacks' tags appear in Cost Explorer (manual)                                            |
| Budgets e-mails (account budget + `hilatech-dev-monthly`)               | 50/80/100% and forecast                                                                                                       |
| CloudWatch dashboard `hilatech-dev` and the alarm e-mails               | health                                                                                                                        |
| App usage page (Settings -> AI usage)                                   | token usage; estimates need `AI_PRICING_JSON`                                                                                 |
| Service Quotas -> Amazon Bedrock                                        | throttling headroom                                                                                                           |

Biggest idle-cost items for dev (all billed hourly): **NAT gateway, RDS, ElastiCache, ALB**, and Fargate tasks. Formulas are in
`docs/operations/cost-model.md`. Saving options: pause compute (`-c pauseServices=true`), or tear everything down (step 23) and re-create when needed.

### Step 22 - Day-2 commands [FREE]

Deploy a new version, roll back, restart after changing a secret, scale, debug the database: see `docs/operations/runbooks.md`.
Backups and restore: `docs/operations/backup-recovery.md`. Objectives: `docs/operations/slos.md`.

### Step 23 - Tear everything down [stops the bill]

Dev is built to be destroyed: buckets and ECR repos are emptied automatically and the database is deleted **without a final snapshot** (export data first if you need it).

```bash
cd infra/cdk
export AWS_PROFILE=hilatech-dev AWS_REGION=<REGION> ENV=dev
npx cdk destroy HilaTech-$ENV-Ops HilaTech-$ENV-App HilaTech-$ENV-Data HilaTech-$ENV-Registry HilaTech-$ENV-Network \
  -c env=$ENV --force
```

Then clean up what CloudFormation intentionally leaves or delays:

```bash
# Secrets Manager keeps deleted secrets for a 30-day recovery window, which blocks re-creating the same names. Remove them now:
for s in $(aws secretsmanager list-secrets --include-planned-deletion --region $AWS_REGION \
    --query "SecretList[?starts_with(Name, 'hilatech/${ENV}/')].Name" --output text); do
  aws secretsmanager delete-secret --secret-id "$s" --force-delete-without-recovery --region $AWS_REGION
done
# Anything tagged for this app still alive? (should be empty or only the pending-deletion items)
aws resourcegroupstaggingapi get-resources --tag-filters Key=app,Values=hilatech Key=env,Values=$ENV \
  --region $AWS_REGION --query 'ResourceTagMappingList[].ResourceARN' --output text
```

Also: delete the ACM certificate and the DNS records if you will not reuse them; the account-level budget stays (free). The `CDKToolkit` bootstrap
stack (tiny S3 bucket + roles) can stay; remove it only if you are leaving AWS (`aws cloudformation delete-stack --stack-name CDKToolkit`, after emptying its bucket).

_Can go wrong:_ `DELETE_FAILED` on the VPC/subnets because of leftover network interfaces (wait a few minutes after the ECS/RDS/ElastiCache stacks finish,
then retry the destroy); ECR repo/bucket not empty on staging/prod (they are _retained_ by design - delete by hand if you really mean to);
deletion protection on staging/prod RDS and the ALB (turn off in `lib/config.ts` and redeploy first - that is intentional friction).
**Verify the next day in Cost Explorer that daily cost has dropped to ~zero** - a forgotten NAT gateway or RDS instance is the classic surprise.

---

## Quick reference

| I want to...                     | Command / place                                                       |
| -------------------------------- | --------------------------------------------------------------------- |
| Log in from the CLI              | `aws sso login --profile hilatech-dev`                                |
| See what the stacks would change | `cd infra/cdk && npx cdk diff <stack> -c env=dev`                     |
| Validate infra without AWS       | `cd infra/cdk && npm run validate && npm test`                        |
| Pause compute                    | `cdk deploy HilaTech-dev-App ... -c pauseServices=true`               |
| Rotate/inspect a secret          | `aws secretsmanager get-secret-value --secret-id hilatech/dev/<name>` |
| Tail logs                        | `aws logs tail /hilatech/dev/api --since 30m --follow`                |
| Check Bedrock access             | steps 7-8                                                             |
| Destroy dev                      | step 23                                                               |

Config knobs: `infra/cdk/lib/config.ts` (sizes, NAT count, WAF, backup, budget limit, allowed Bedrock models/regions).
CDK context flags: `env`, `certificateArn`, `domainName`, `alarmEmail`, `imageTag`, `pauseServices`.
