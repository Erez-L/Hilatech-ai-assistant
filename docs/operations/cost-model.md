# Cost model (formulas and drivers - NO dollar figures)

This document tells you **what you will be billed for and how to estimate it**. It deliberately contains no prices:
AWS prices change by region and over time, and I did not fetch them. Fill the placeholders (`<...>`) from the
[AWS Pricing Calculator](https://calculator.aws/) (or the pricing pages linked in
`docs/architecture/aws-capability-matrix.md`) for the region you deploy to, and record the date you looked.

Resource sizes come from `infra/cdk/lib/config.ts` (dev / staging / prod). Re-estimate whenever you change them.

## 1. Always-on infrastructure (the "idle bill")

These cost money whether or not anyone uses the product. Monthly cost = rate x quantity x hours (about 730 h/month,
**verify the hour convention in the calculator**).

| Resource                                  | Quantity driver (dev / staging / prod)      | Formula                                                                                                                                                    | Rate to look up                                                                                                        |
| ----------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| NAT gateway                               | 1 / 1 / 2                                   | `n_nat x (<$/NAT-hour> x 730) + GB_processed x <$/GB>`                                                                                                     | NAT gateway hourly + data processing                                                                                   |
| Elastic IP                                | one per NAT (public IPv4 is billed)         | `n_nat x <$/public-IPv4-hour> x 730`                                                                                                                       | public IPv4 address hourly                                                                                             |
| ALB                                       | 1                                           | `<$/ALB-hour> x 730 + LCU_hours x <$/LCU-hour>`                                                                                                            | ALB hourly + LCU (new connections, active connections, processed bytes, rule evaluations; the highest dimension bills) |
| Fargate - api                             | 1-2 / 1-3 / 2-10 tasks                      | `avg_tasks x 730 x (vCPU x <$/vCPU-h> + GiB x <$/GiB-h>)`                                                                                                  | Fargate Linux/x86 (or Arm) vCPU-hour + GiB-hour                                                                        |
| Fargate - web                             | same                                        | same                                                                                                                                                       | same                                                                                                                   |
| Fargate - workers                         | same                                        | same                                                                                                                                                       | same                                                                                                                   |
| RDS PostgreSQL                            | instance class per env                      | `730 x <$/instance-hour> (x2 if Multi-AZ) + storage_GiB x <$/GiB-month> + IOPS/throughput extras if provisioned`                                           | RDS PostgreSQL, instance class, gp3 storage                                                                            |
| RDS backup storage                        | automated backups beyond the free allotment | `(backup_GiB - free_GiB) x <$/GiB-month>`                                                                                                                  | RDS backup storage                                                                                                     |
| ElastiCache Redis                         | node type x (1 + replicas)                  | `nodes x 730 x <$/node-hour>`                                                                                                                              | ElastiCache node type                                                                                                  |
| Interface VPC endpoints (prod)            | 5 endpoints x 2 AZ                          | `5 x 2 x 730 x <$/endpoint-AZ-hour> + GB x <$/GB>`                                                                                                         | VPC interface endpoint hourly + data                                                                                   |
| WAF (staging/prod)                        | 1 web ACL, 4 rules                          | `<$/web-ACL-month> + 4 x <$/rule-month> + requests_millions x <$/M-requests>` (managed rule groups may add a charge)                                       | WAF                                                                                                                    |
| Secrets Manager                           | ~7 secrets                                  | `n_secrets x <$/secret-month> + API_calls/10k x <$/10k-calls>`                                                                                             | Secrets Manager                                                                                                        |
| CloudWatch                                | logs, alarms, dashboard                     | `GB_ingested x <$/GB> + GB_stored x <$/GB-month> + n_alarms x <$/alarm-month> + n_dashboards x <$/dashboard-month>` (+ Container Insights metrics in prod) | CloudWatch                                                                                                             |
| VPC flow logs (staging/prod)              | REJECT only                                 | `GB_ingested x <$/GB>`                                                                                                                                     | CloudWatch Logs ingestion                                                                                              |
| AWS Backup (staging/prod)                 | RDS + S3                                    | `warm_backup_GiB x <$/GiB-month>` (RDS and S3 rates differ)                                                                                                | AWS Backup                                                                                                             |
| ECR                                       | 3 repos                                     | `stored_GiB x <$/GiB-month>` (+ data transfer)                                                                                                             | ECR                                                                                                                    |
| S3                                        | documents + logs                            | `stored_GiB x <$/GiB-month> + requests x <$/1k> `                                                                                                          | S3 Standard                                                                                                            |
| KMS / ACM public certificate / SNS e-mail | -                                           | ACM public certs are free; SNS e-mail and Budgets have small or no charges - confirm                                                                       |                                                                                                                        |

**Dev-environment levers (biggest first, all in `lib/config.ts` or by pausing):**

1. `-c pauseServices=true` sets Fargate desired count to 0 (compute stops; NAT, ALB, RDS, Redis keep billing).
2. `cdk destroy` everything between work sessions (see teardown in the setup guide) - the only way to stop the idle bill.
3. NAT gateway is usually the largest surprise in a small VPC; the S3 gateway endpoint keeps S3 traffic off it.
4. Stop the RDS instance when idle (AWS auto-restarts stopped RDS instances after 7 days - confirm current behaviour).
5. Use `redis.kind: 'external'` or accept the single small node.

## 2. Usage-based costs

| Driver                            | Formula                                    | Notes                                                                       |
| --------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Data transfer out to the internet | `GB_out x <$/GB>` after the free allotment | streamed AI responses and downloads                                         |
| NAT data processing               | `GB_through_NAT x <$/GB>`                  | image pulls (without ECR endpoints), outbound calls, Bedrock if no endpoint |
| Cross-AZ traffic                  | `GB x <$/GB>`                              | ALB->task, task->RDS across AZs                                             |
| S3 requests                       | PUT/GET counts                             | document ingestion/download                                                 |
| WAF requests                      | millions of requests                       |                                                                             |
| CloudWatch Logs                   | GB ingested                                | `LOG_LEVEL=debug` in dev multiplies this                                    |

## 3. AI token cost (Bedrock, Anthropic, OpenAI ...)

Token spend is usually the largest variable cost. The application already estimates it per request - **using only
prices you supply** (ADR-012). It ships none.

### 3.1 Supply prices: `AI_PRICING_JSON`

USD per **1 million** tokens, one entry per `(provider, model)`. Copy the numbers from the provider's pricing page
for the region/mode you actually use, and note the date.

```json
[
  {
    "provider": "bedrock",
    "model": "amazon.nova-micro-v1:0",
    "inputPerMillionUsd": "<from https://aws.amazon.com/bedrock/pricing/>",
    "outputPerMillionUsd": "<from the same page>"
  }
]
```

(Placeholders above are **not** valid JSON numbers: replace them with numbers before use. Invalid content is
logged and ignored, giving `estimatedCostUsd = null`.) The `model` string must equal the id you configured,
including any inference-profile prefix (`global.anthropic...` is a different key from `anthropic...`).

Set it as a plain env var on the API and workers (add to the container environment in `app-stack.ts`, or via the
env file locally). Models without an entry produce `null` estimates - never guesses.

### 3.2 Estimating before you ship

For each workload `w` (assistant chat, agent runs, knowledge ingestion, ...):

```
cost_w/month = ( requests_w x avg_input_tokens_w  / 1_000_000 x input_price_per_M
               + requests_w x avg_output_tokens_w / 1_000_000 x output_price_per_M )
```

- `avg_input_tokens` includes system prompt + tool schemas + retrieved passages + conversation history. Agents make
  several model calls per run (one per step), and each step resends the history: `input_tokens_run ~ sum over steps of context size`.
- Tool-heavy agents are dominated by input tokens; get real numbers from the usage page of the product (it records
  tokens per request) after a day of dev use, rather than guessing.
- **Embeddings:** Titan V2 is billed per input token, Cohere typically per token too (confirm on the pricing page),
  but **throttled per request**. Ingestion cost `~ total_chunk_tokens / 1_000_000 x embedding_price_per_M`; re-embedding
  (model change) pays it again. The adapter reports Titan's `inputTextTokenCount`; Cohere responses carry no token
  count, so Cohere usage is recorded as 0 tokens (cost estimates for Cohere embeddings will read as zero/unknown).
- Cross-region/global inference profiles: pricing is by source region per the AWS docs; global profiles were
  described as cheaper than geographic ones - **check the current pricing page**, do not assume.
- Per-tenant protection: the product's budgets and admission control (billing module) are the guardrail; the AWS
  Budget in `Ops` only warns about the _account_ spend, with delay.

### 3.3 Bedrock vs. direct provider API

Same model family can have different prices, quotas and data-handling terms through Bedrock vs. the vendor's API.
Compare on: price per million tokens (input/output), rate limits you actually get, regional availability,
data-residency needs, and the operational benefit of IAM auth. This repo does not recommend one.

## 4. Optional services (not deployed by default)

| Service                                                   | Billing dimensions (from the AgentCore pricing page)                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| AgentCore Runtime                                         | vCPU-seconds + GB-seconds (idle I/O generally unbilled), optional committed baseline, ECR/S3 storage              |
| AgentCore Gateway                                         | per API operation, per search query, per indexed tool, VPC egress processing                                      |
| AgentCore Memory                                          | short-term: events + storage + retrieval; long-term: per record + retrieval (+ model usage for custom strategies) |
| AgentCore Identity / Policy / Evaluations / Observability | per token requested / per authorization request / tokens or per evaluation / CloudWatch rates                     |
| Bedrock Knowledge Bases                                   | Bedrock pricing page + the vector store (Aurora/OpenSearch/S3 Vectors)                                            |
| CloudFront                                                | requests + data out (partially offset by lower ALB/NAT transfer)                                                  |

## 5. Worksheet

Fill one row per environment per month. Keep the calculator link/estimate ID and date.

| Line                                                   | dev | staging | prod |
| ------------------------------------------------------ | --- | ------- | ---- |
| NAT + EIP                                              |     |         |      |
| ALB                                                    |     |         |      |
| Fargate (api+web+workers)                              |     |         |      |
| RDS (instance + storage + backup)                      |     |         |      |
| ElastiCache                                            |     |         |      |
| VPC endpoints                                          |     |         |      |
| WAF                                                    |     |         |      |
| CloudWatch (logs, alarms, dashboard, insights)         |     |         |      |
| Secrets Manager, ECR, S3, Backup                       |     |         |      |
| Data transfer                                          |     |         |      |
| **Infrastructure subtotal**                            |     |         |      |
| AI tokens (chat / agents / embeddings), from section 3 |     |         |      |
| **Total**                                              |     |         |      |
| Budget set in CDK (`budget.monthlyLimitUsd`) vs. total |     |         |      |

Review monthly in **Cost Explorer** (group by service and by the `env`/`app` tags the stacks apply; tags must be
activated as cost-allocation tags in the Billing console before they appear - a manual step).
