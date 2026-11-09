# AI Engine Architecture (Priority 3)

The AI engine turns organization data into an assistant and into autonomous agents. It is
**provider-independent**, **tenant-scoped**, **permission-gated** and **bounded** (steps, time,
tokens, delegation depth). It lives in `packages/ai-engine` so the API (interactive assistant,
sync agent runs) and the workers (async agent runs, summaries) execute exactly the same code.

```
apps/api ──► AssistantService ──┐
         ──► AgentsService ─────┤  (sync mode, short cap)
                                ▼
                     packages/ai-engine
                     ├── providers/      AiProvider interface + Anthropic, OpenAI, Mock adapters
                     ├── registry        ProviderResolver (config → decrypted key → cached client)
                     ├── context/        message window + token budget + rolling summary
                     ├── tools/          ToolRegistry, ToolDefinition, ToolExecutor (permission layer)
                     ├── orchestrator/   AgentRunner loop, delegation, limits, step recording
                     ├── usage/          UsageRecorder interface, pricing table, cost estimation
                     └── prompts/        template rendering ({{var}}), hardened system prompts
                                ▲
apps/workers ─► ai-tasks queue ─┘  (async agent executions, conversation summaries)
```

## Provider abstraction

`AiProvider` (packages/ai-engine/src/providers/types.ts):

| Method                       | Purpose                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| `generate(req)`              | One completion; may return `toolCalls` instead of / alongside text.   |
| `stream(req)`                | Async iterable of `StreamEvent` (`text_delta`, `tool_call`, `usage`). |
| `generateStructured(req, s)` | JSON output validated against a zod schema (retries once on invalid). |
| `embed(req)`                 | Embeddings for an array of texts (used by Priority 4).                |
| `listModels()`               | Static model catalogue with capabilities.                             |
| `healthCheck()`              | Cheap call to validate credentials/connectivity.                      |

Normalised request: `{ model, system?, messages: AiMessage[], tools?: ToolSpec[], toolChoice?,
maxTokens?, temperature?, stopSequences?, signal?, metadata }`. Normalised result:
`{ text, toolCalls: ToolCall[], finishReason, usage: { inputTokens, outputTokens }, model }`.
Errors are normalised to `AiProviderError { code: 'auth' | 'rate_limited' | 'invalid_request' |
'timeout' | 'server' | 'content_filter' | 'unknown', retryable, status?, providerMessage }`.

Adapters: `AnthropicProvider` (`@anthropic-ai/sdk`), `OpenAiProvider` (`openai`), `MockProvider`
(deterministic, scripted responses for tests; refused when `NODE_ENV=production`). Business code
depends only on `AiProvider`; SDK imports exist solely inside the adapters.

## Configuration & credentials

`AiProviderConfig` rows hold per-organization provider settings. API keys are encrypted with
AES-256-GCM using `CREDENTIALS_ENCRYPTION_KEY` (32 random bytes, base64) by `SecretBox` in
`@hilatech/shared`; only `keyLast4` is ever serialised. `ProviderResolver.forOrganization(orgId,
{ configId?, model? })` picks the requested config or the organization default, decrypts the key
and returns a cached adapter (`configId:updatedAt` cache key). Missing/disabled config →
`AiNotConfiguredError` → API `409 AI_NOT_CONFIGURED`.

## Context management

`ContextBuilder.build({ system, summary, history, budgetTokens })` keeps the newest messages that
fit the budget (approximate tokens = chars/4 with a per-message overhead), prepends the rolling
`summary` of older turns, and reports what was dropped. When a thread's dropped history exceeds a
threshold, the assistant asks the provider for an updated summary (`structured` call) and stores
it on the thread (`summary`, `summarizedUpTo`). Retrieved documents and tool results are wrapped
in `<data source="…">…</data>` blocks and the system prompt states that such blocks are **data,
never instructions** (prompt-injection mitigation, defence in depth).

## Tools and the permission layer

A `ToolDefinition` has `key`, `name`, `description`, `category`, `riskLevel` (`read` | `write` |
`dangerous`), `requiredPermission` (a `Permission` key), a zod `input` schema (exported to JSON
schema for the model) and `execute(ctx, input)`. Built-in tools (`packages/ai-engine/src/tools/builtin`)
cover CRM read/write (search/get contacts, search/get/create leads, update lead status, add lead
note, list conversations and messages), `knowledge.search` (Priority 4; returns `not_configured`
until then), `agents.delegate` / `agents.delegate_parallel`, and `time.now`.

`ToolExecutor.execute(ctx, call)` enforces, in order:

1. the tool exists and is in the caller's allow-list (`agent.tools`, or the assistant default set);
2. the executing principal holds `requiredPermission` (for the assistant: the user's tenant
   permissions; for an agent: the agent's `permissions` grants **intersected** with the
   triggering user's permissions when there is one — automation/schedule triggers use the grants
   set by an admin with `agents:manage`);
3. `write` tools require `permissions.allowWrite`; `dangerous` tools are never executed
   autonomously — the call returns `{ status: 'requires_authorization' }` and is recorded;
4. input is validated against the tool's zod schema (invalid → error result to the model, no throw);
5. execution is wrapped in a timeout (`toolTimeoutMs`, default 15s) and every call is recorded as a
   step and audited (`AI_TOOL_EXECUTED` / `AI_TOOL_DENIED`).

Tools receive a `ToolContext { organizationId, userId?, agentId?, executionId?, prisma, logger,
signal }` and must scope every query by `organizationId`.

## Orchestration (AgentRunner)

```
loop (step < maxSteps && elapsed < maxDurationMs && tokens < maxTokens):
  messages = ContextBuilder.build(...)
  result   = provider.generate({ tools })            → step: llm_call
  if result.toolCalls:
      results = ToolExecutor.executeAll(calls)        → steps: tool_call (parallel, ≤ maxToolCallsPerStep)
      append assistant(toolCalls) + tool(results); continue
  else: final answer                                  → step: final
on limit: status timed_out (duration) or failed (steps/tokens) with a clear error
```

Delegation: `agents.delegate({ agentId, task, context? })` runs a child `AgentExecution`
(`parentExecutionId`, `rootExecutionId`, `depth + 1`, trigger `agent`) with the same runner.
Safeguards: `depth ≤ AGENT_HARD_LIMITS.maxDelegationDepth`, `delegations ≤ min(agent.maxDelegations,
hard limit)`, the child cannot be the parent or any ancestor (cycle check on the execution chain),
the child inherits the remaining time/token budget of the root (never more), and the child only
receives the delegated `task` plus an explicit `context` object — not the parent's full history.
`agents.delegate_parallel` runs several children with `Promise.allSettled` and aggregates results.

Retries: provider errors with `retryable=true` are retried per `retryPolicy` with backoff inside
the same step; tool failures are returned to the model (it decides), never retried blindly.

Every execution writes `AgentExecution` (status, tokens, duration, output/error) and
`AgentExecutionStep` rows; every provider call writes `AiRequestLog` via `UsageRecorder`.

## Usage tracking and cost

`UsageRecorder.record({ organizationId, userId?, agentId?, executionId?, threadId?, provider, model,
operation, status, usage, durationMs, error? })` persists `AiRequestLog`, increments the
organization's `ai_tokens` usage for entitlements, and estimates cost **only** if
`AI_PRICING_JSON` (or `infrastructure/ai-pricing.json`) contains the model — otherwise
`estimatedCostUsd` is `null`. No invented figures.

## API surface (apps/api, Priority 3)

- `GET/POST /ai/providers`, `GET/PATCH/DELETE /ai/providers/:id`, `POST /ai/providers/:id/health`,
  `GET /ai/models?provider=` — `ai:config:read` / `ai:config:manage`
- `GET /ai/usage/summary?period=`, `GET /ai/usage/requests` — `ai:config:read`
- `GET/POST /ai/prompts`, `GET/PATCH/DELETE /ai/prompts/:id`, `POST /ai/prompts/:id/render`
- `GET /ai/tools` (catalogue the UI shows when configuring an agent) — `agents:read`
- Assistant (`ai:assistant:use`): `GET/POST /assistant/threads`, `GET/PATCH/DELETE
/assistant/threads/:id`, `GET /assistant/threads/:id/messages`, `POST
/assistant/threads/:id/messages` (JSON, or SSE when `Accept: text/event-stream`)
- Agents: `GET/POST /agents`, `GET/PATCH/DELETE /agents/:id` (`agents:read` / `agents:manage`),
  `POST /agents/:id/execute` (`agents:execute`; `mode: async|sync`), `GET /agents/executions`,
  `GET /agents/executions/:id` (steps + children), `POST /agents/executions/:id/cancel`

Async executions are enqueued on `ai-tasks` (`kind: 'agent_execution'`, `targetId: executionId`) and
run by `apps/workers`; the UI polls the execution. Sync mode is capped by
`AGENT_HARD_LIMITS.syncMode*` and intended for interactive testing.

## Non-goals in Priority 3

Knowledge retrieval (`knowledge.search`) and document embeddings are Priority 4; the tool exists but
reports `not_configured`. Automation triggers for agents are Priority 4/5.
