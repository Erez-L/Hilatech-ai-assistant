# AgentCore integration architecture

Status: **decision + design only**. The only AWS-facing code that exists is the Bedrock _model_ provider adapter
(`packages/ai-engine/src/providers/bedrock.ts`, unit-tested with a mocked client, never run against real AWS).
Capability facts and their verification labels are in [aws-capability-matrix.md](./aws-capability-matrix.md).

## Decision

1. **`AgentRunner` stays the default (and only shipped) orchestrator.** It already provides what the product
   promises: per-agent step/time/token/delegation budgets shared across delegation (ADR-011), a permission-gated
   tool layer with an audit trail (ADR-010), per-step persistence (`AgentExecutionStep`), usage/cost logging per
   provider call, and tenant scoping on every tool call. None of that is something AgentCore gives us for free;
   moving the loop would mean re-implementing those guarantees outside our process.
2. **Bedrock is integrated at the model layer** - a `bedrock` kind of `AiProvider`. This delivers "AWS-first" (IAM
   roles instead of stored API keys, private VPC endpoint, CloudTrail, consolidated AWS billing) without changing
   orchestration. A customer or environment can switch an agent between `anthropic`, `openai` and `bedrock` with a
   provider-config change.
3. **AgentCore is an optional, later, per-agent execution backend behind an interface** - not built now.
4. **Not AWS-locked:** the product runs unchanged with Docker Compose, with `anthropic`/`openai`/`mock`
   providers, with local disk storage and with any S3-compatible store. Every AWS piece is behind an existing seam
   (`AiProvider`, `StorageDriver`, env config) or is infrastructure-as-code outside the app.

## Layering (what talks to what)

```
                          +----------------------------+
 Web / API request  ----> | AgentRunner (default)      |  budgets, delegation, steps, audit
                          |  - ToolExecutor (perms)    |
                          |  - ContextBuilder          |
                          +-------------+--------------+
                                        | AiProvider (generate/stream/structured/embed)
              +-------------------------+---------------------------+
              |                         |                           |
      AnthropicProvider           OpenAiProvider              BedrockProvider      <-- built
      (API key)                   (API key)                   (IAM role -> Bedrock Converse)

 Optional, NOT BUILT:   AgentExecutionBackend  --->  AgentCoreRuntimeBackend (hosted agent, SigV4/OAuth invoke)
                        ToolTransport          --->  AgentCoreGatewayTransport (MCP over Gateway)
```

### Seam 1 - model inference (built): `BedrockProvider`

- Credentials: AWS SDK default provider chain only (ECS task role in AWS, `AWS_PROFILE` SSO locally). No keys in
  the database, env schema or UI.
- Region: per provider config (`AiProviderConfig.region`), falling back to `AWS_REGION`/profile region.
- Server-wide switch `AI_BEDROCK_ENABLED` (default **false**): Bedrock calls are billed to the _platform's_ AWS
  account and run with the _server's_ identity, so in a multi-tenant deployment any organization admin who can
  create a Bedrock config would spend the platform's money. Operators opt in deliberately; a tenant-supplied
  `baseUrl` is ignored for Bedrock so a tenant cannot redirect SigV4-signed requests. Per-tenant spend is still
  governed by the existing budget/admission-control and usage logging.
- IAM: `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` only, on explicit model/profile ARNs from
  `infra/cdk/lib/config.ts` (`bedrock.allowedModelIds`, `allowedRegions`).
- Cost: `AI_PRICING_JSON` accepts `"provider":"bedrock"` entries; unpriced models stay `null`.

### Seam 2 - orchestration backend (designed, **not built**)

```ts
// Proposed shape - NOT in the codebase.
interface AgentExecutionBackend {
  readonly kind: 'agent-runner' | 'agentcore-runtime';
  run(request: RunRequest, hooks: RunHooks): Promise<RunResult>; // same RunRequest/RunResult as today
}
```

`AgentRunner` would be the `agent-runner` implementation. An `agentcore-runtime` implementation would call
`InvokeAgentRuntime` on an agent container we publish to ECR (ARM64, per the Runtime docs) and translate the result
into `RunResult`. Selection would be a per-agent setting, defaulting to `agent-runner`.

Why not now:

- **Budgets and permissions would leave our process.** The hosted agent would need our tenant-scoped tools, so we
  would have to expose them to AWS (through Gateway as MCP tools, with Identity/Policy mirroring our RBAC). That is
  a second authorization system to keep consistent with `ToolExecutor`; a mistake there is a cross-tenant data risk.
- **No requirement it solves.** Nothing in the current roadmap needs microVM session isolation, 8-hour async runs,
  or managed agent memory.
- **Operational and cost surface:** a separate ARM64 build, a second deployment pipeline, extra per-second and
  per-operation billing dimensions (see matrix), and quota/region constraints (Memory is in 16 of 22 regions).
- **Maturity/verification:** I could not verify hands-on behaviour; several services reached GA only in 2026
  (Policy 2026-03-03, Evaluations 2026-03-31) and some pages do not state status.

Revisit when: (a) agents must execute untrusted/generated code (Code Interpreter / Browser need isolation we do not
have), (b) a customer requires agents hosted in their own AWS account, (c) agent runs routinely exceed what a
BullMQ worker can host, or (d) AWS-native evaluation/observability becomes a procurement requirement.

### Seam 3 - tool transport (designed, **not built**)

Today tools are in-process `ToolDefinition`s. If we ever need to (a) call tools that live in other systems, or (b)
expose our tools to external agents, the natural unit is **MCP**:

- _Outbound:_ an `McpToolSource` that registers remote tools into `ToolRegistry` with the same
  `requiredPermission`/`riskLevel` metadata and the existing SSRF guard (`OUTBOUND_ALLOWED_HOSTS`). AgentCore
  Gateway could be one such remote (it converts OpenAPI/Lambda targets to MCP and offers semantic tool search).
- _Inbound:_ an MCP server facade over `ToolExecutor` (never bypassing it) for external agents.

Both would reuse, not replace, the permission layer. Not built: no consumer exists, and MCP auth for multi-tenant
use (per-org tokens) needs its own design and threat model.

## What is deliberately NOT built, and why

| Not built                                                         | Why                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AgentCore Runtime adapter / `AgentExecutionBackend`               | See "Why not now". Interface sketched only.                                                                                                                                                    |
| AgentCore Gateway / MCP transport                                 | No remote tools or external consumers yet; auth model undecided.                                                                                                                               |
| AgentCore Memory                                                  | We store conversation context and knowledge in Postgres with tenant scoping; a second memory store duplicates PII and retention rules.                                                         |
| AgentCore Identity / Policy                                       | Our RBAC + tool permission layer is authoritative; AWS Policy would only matter once tools run behind Gateway.                                                                                 |
| AgentCore Observability / Evaluations                             | Execution steps and usage logs already exist in Postgres; revisit if OpenTelemetry tracing is adopted. Cost model lists them as optional.                                                      |
| Bedrock Knowledge Bases                                           | Decision recorded in the matrix (pgvector kept; RDS PostgreSQL is not a listed KB store).                                                                                                      |
| Intelligent Prompt Routing                                        | Not Claude-family, English-only, hides the model from cost attribution.                                                                                                                        |
| Bedrock Guardrails                                                | Not evaluated. `guardrailConfig` is a straightforward future addition to `toConverseInput`; content-filter stop reasons are already mapped to `content_filter`.                                |
| Bedrock `outputConfig.textFormat` structured output               | Per-model support unknown and schema restrictions differ from our zod schemas; forced tool call works everywhere tools do.                                                                     |
| Prompt caching / `cachePoint`, images/documents, reasoning blocks | Out of scope for the first adapter. Reasoning models require replaying `signature` blocks; our neutral message type has no place for them, so **reasoning-mode models are not supported yet**. |
| Cohere Embed v4, Titan v1                                         | Different/unverified schemas; adapter rejects unknown embedding models instead of guessing.                                                                                                    |
| Provisioned Throughput                                            | Not compatible with cross-region profiles; not needed at demo scale.                                                                                                                           |

## Verification status of what exists

| Item                                       | Status                                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BedrockProvider` request/response mapping | Unit-tested against a mocked SDK client (28 tests). **No live Bedrock call has ever been made.** Shapes follow the AWS docs and `@aws-sdk/client-bedrock-runtime` type definitions.                            |
| Credential resolution                      | Delegated to the AWS SDK default chain; **unverified** in this repo (no credentials available).                                                                                                                |
| IAM policy for inference profiles          | Generated by CDK, reviewed by `cdk-nag`, **not tested against real IAM**. The global-profile statement is the most likely to need adjustment; read the CloudTrail `AccessDenied` event for the exact resource. |
| Streaming                                  | Event handling follows the documented ConverseStream order; mid-stream exception members are mapped. Unverified live.                                                                                          |
