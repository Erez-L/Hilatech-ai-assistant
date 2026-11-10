# Knowledge Base, RAG and Automation (Priority 4)

## Knowledge base & RAG

```
upload (API) ──► Document(uploaded) + object storage ──► document-processing job ──► workers:
   validate → extract text → normalise → chunk → DocumentChunk rows → embeddings job(s) ──► workers:
   embed (provider) → pgvector column → Document(ready, chunkCount) → event document.processed
search (API /knowledge/search, tool knowledge.search) ──► embed query → pgvector cosine search (org-scoped)
```

- **Storage**: `@hilatech/storage` (`StorageDriver`: local disk or S3-compatible). Keys are
  `org/<orgId>/documents/<yyyy>/<mm>/<uuid><ext>`; the API streams uploads to storage and never
  exposes raw keys as URLs. Downloads go through an authenticated, tenant-checked endpoint.
- **Validation**: MIME allow-list (`SUPPORTED_DOCUMENT_MIME_TYPES`), size cap `MAX_UPLOAD_MB`,
  per-plan `knowledgeDocuments` / `storageMb` entitlements checked before accepting a file.
- **Extraction** (workers): text/markdown/csv/json/html via built-ins (HTML tags stripped), PDF via
  `pdf-parse`. Unsupported or empty results mark the document `failed` with a clear error.
- **Chunking**: `chunkText` from `@hilatech/ai-engine` (≈400 token chunks, 60 token overlap,
  paragraph/sentence aware). Chunk metadata records `{ page?, heading?, offset }`.
- **Embeddings**: `EmbeddingService` — organization's embedding-capable provider (OpenAI
  `text-embedding-3-*`, or mock in development); every vector normalised to `EMBEDDING_DIMENSIONS`
  (1536) so one HNSW index (`vector_cosine_ops`) serves all tenants. Usage recorded as
  `operation: 'embed'`.
- **Retrieval**: `PgVectorStore.search` — cosine distance, organization-scoped, optional knowledge-base
  and metadata filters, `minScore` cut-off, over-fetch 3× then trim. Results carry document title,
  chunk index and score → used by `/knowledge/search` and by the `knowledge.search` tool, whose
  results are wrapped in `<data>` blocks for the model (source attribution = document title + chunk).
- **Isolation**: every SQL statement filters `organizationId`; cross-tenant tests assert that a
  query from org B never returns org A chunks even with identical content.

## Automation

```
API: manual run / inbound webhook ─► WorkflowExecution(queued) ─► automation.execute ─┐
API: domain event ────────────────► automation.event ─► fan-out (workflows + webhooks) ─┤
workers: schedule_tick (every minute) ─► due cron workflows ─► WorkflowExecution(queued) ─┘
                                                                                         ▼
                                              WorkflowRunner (workers): steps in order, templates,
                                              conditions, delays (resume job), step results persisted
```

- **Triggers** (`workflowTriggerSchema`): `manual`, `event` (DomainEvent), `schedule` (5-field cron
  in the organization's timezone), `webhook` (inbound endpoint bound to the workflow).
- **Domain events**: the API emits through `DomainEventsService.emit(orgId, event, payload, actor)`
  which enqueues one `automation.event` job; workers fan out to (a) enabled workflows whose trigger
  matches, (b) enabled outbound `Webhook` subscriptions (creates `WebhookDelivery(pending)` rows and
  `webhook-delivery` jobs). Emission points: lead created/status/assigned/converted, contact
  created, conversation created/message/assigned/resolved, document processed/failed, agent
  execution completed/failed, member joined.
- **Inbound webhooks**: `POST /api/v1/hooks/:organizationSlug/:endpointSlug` (public, rate-limited).
  Auth: `x-hilatech-signature: sha256=<hmac(body, secret)>` or `x-webhook-secret: <secret>`; the
  stored value is the SHA-256 of the secret; constant-time compare. On success: create execution +
  `automation.execute` job; respond `202 { executionId }`.
- **Outbound webhooks**: HMAC-SHA256 over `timestamp.body` with the subscription secret
  (`x-hilatech-signature`, `x-hilatech-timestamp`, `x-hilatech-event`); retries with exponential
  backoff (5 attempts) tracked on the delivery row; `failed` after the last attempt. URLs must be
  https (http only for localhost) and are checked against private/loopback ranges (SSRF guard)
  before every request.
- **WorkflowRunner** (workers): resolves `{{ path }}` templates against `{ trigger, input, steps }`;
  executes steps sequentially; `condition` chooses which listed step ids run; `delay` persists
  progress and re-enqueues `automation.resume` with the delay; `agent_run` creates an
  `AgentExecution` and runs it inline (wait=true) or enqueues `ai-tasks`; `send_notification`
  writes notification rows (same rules as the API's NotificationsService); `http_request` uses the
  SSRF guard and a timeout; `update_lead` / `create_lead_note` write CRM rows with activities;
  `n8n_trigger` posts to the organization's n8n integration; `outbound_webhook` creates deliveries.
  Each step result is appended to `WorkflowExecution.stepResults`; failures mark the execution
  `failed` with the step id. Limits: ≤ 30 steps, ≤ 15 min per execution, ≤ 60 s per HTTP step.
- **n8n**: optional. The `n8n` integration kind holds the base URL and API key; `n8n_trigger` steps and
  the `/integrations/:id/test` endpoint use it. The core never depends on n8n being present.

## Integrations

`Integration` rows hold `kind`, non-secret `config` (validated per kind by `integrationConfigSchema`)
and `encryptedSecrets` (SecretBox, organization-bound). `POST /integrations/:id/test` runs a
kind-specific connectivity check (HTTP reachability, n8n health) and stores
`status`/`lastError`. Live support in this release: `rest` and `n8n` only (`liveSupport: 'full'`).
`email`, `whatsapp` and `crm` are configuration + validation only (`liveSupport: 'planned'`): secrets can be stored,
nothing is sent and no connectivity test can pass, so they never pretend to work. (System email — invitations, password
reset — is separate and uses the workers' `EMAIL_DRIVER` `log`/`smtp`; it is not an integration row.)
