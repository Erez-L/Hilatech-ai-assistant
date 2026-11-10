# Product Vision

Status of this document: vision and positioning come from the repository README, the landing page copy
(`apps/web/src/app/(marketing)/page.tsx`) and the architecture decisions. "Today" statements are checked against the code
on 2026-11-10; see [feature-matrix.md](./feature-matrix.md) for per-feature status. No customer research exists in the
repository, so the personas below are **working assumptions derived from the role model**, not validated findings.

## Vision

An operational assistant for small and mid-size businesses: one secure workspace where AI answers questions about the
business, helps staff manage customers and leads, executes bounded tasks through agents, automates routine follow-up, and
reports what happened — built as the foundation of a commercial multi-tenant SaaS product.

## Principles (visible in the code)

1. **Tenant isolation first.** Every record belongs to an organization; isolation is enforced server-side and tested with
   dedicated cross-tenant suites ([tenant-isolation.md](../architecture/tenant-isolation.md)).
2. **The AI acts with least privilege and a paper trail.** Agents run with hard budgets (steps, time, tokens, delegation
   depth); every tool call passes a permission layer and is audited; write actions are gated.
3. **No pretending.** Unconfigured capabilities (no AI provider, no pricing, no payments, no WhatsApp/CRM provider) are
   shown as "not configured" instead of simulated. Placeholders never display fabricated data.
4. **Provider independence.** Anthropic, OpenAI, Amazon Bedrock and a mock provider sit behind one interface; the product runs
   without any AWS service.
5. **Cost control is a feature.** Per-plan limits, per-organization monthly AI token/cost budget with a hard stop and alerts.
6. **Explainability.** Agent executions are stored step by step and can be inspected; automation runs record each step result.

## Who it is for (working assumptions)

| Persona                        | Role in the product                                                        | What they do today in the product                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business owner / administrator | `owner`, `admin` system roles                                              | Creates the organization, invites the team, defines roles, connects an AI provider, sets the AI budget, reviews audit and analytics, manages plan limits |
| Sales / customer-service staff | `member` system role (or a custom role)                                    | Works leads, contacts and conversations; asks the assistant for help; runs agents; reads dashboards                                                      |
| Operations / power user        | custom role with `automations:manage`, `knowledge:manage`, `agents:manage` | Builds knowledge bases, agents, workflows, webhooks and integrations                                                                                     |
| End customer of the tenant     | none (not a user)                                                          | Has no interface. Real customer channels (web chat, email, WhatsApp) are not built                                                                       |

## Value proposition vs. what exists today

| Promise (landing page)                     | Reality on 2026-11-10                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| "Talks to your customers across channels"  | **Not delivered.** Conversations are recorded by staff; no channel connectors; AI does not reply to customers                              |
| "Manages leads and contacts"               | **Delivered** (CRUD, assignment, notes, timeline, conversion). No import/export, no deals/Kanban, no tasks                                 |
| "Agents that execute"                      | **Delivered with the mock provider**; never run against a live LLM. Delegation, budgets, permission layer, inspector exist                 |
| "Knows your business"                      | **Delivered with mock embeddings**; text, markdown, CSV, HTML, JSON and text-based PDF documents; semantic search; `knowledge.search` tool |
| "Automates the routine"                    | **Delivered**: workflows (4 triggers, 10 step types), webhooks, n8n via HTTP. No email/WhatsApp send step; no visual canvas                |
| "Reports back"                             | **Delivered**: dashboard, five report tabs, CSV export (business, usage), usage vs plan, audit log                                         |
| "Built for teams / isolated / accountable" | **Delivered** and covered by automated tests                                                                                               |

The landing page copy for the first promise overstates the current product and should be reconciled with the roadmap
before any external use.

## Product scope

**In scope (built):** identity and organizations; roles and permissions; CRM (contacts, leads, conversations,
notifications); AI assistant; agents; knowledge base and RAG; automation and webhooks; integration framework (REST, n8n);
analytics; billing readiness (plans, entitlements, usage, AI budget); audit.

**Planned / not built:** live channels and AI customer replies; deals and tasks; import/export; payments; Hebrew UI with RTL;
evaluation datasets; agent teams UI and long-term memory; visual workflow canvas; MFA/SSO; production AWS deployment.
Prioritisation and rationale: [implementation-plan.md](../development/implementation-plan.md) and
[gap-analysis.md](../development/gap-analysis.md).

## Success measures (proposed, not instrumented)

The product records the raw data for these (audit log, usage records, agent executions, workflow executions), and the
Analytics page already reports most of them per organization:

- Activation: organization created → first teammate invited → first AI provider configured → first knowledge document
  `ready` → first agent run `succeeded`.
- Engagement: weekly active members; assistant messages; agent executions and success rate; workflow runs.
- Business impact for a tenant: leads created, converted, won; value won; time to first assignment.
- Cost: AI tokens and estimated cost against plan and budget.

There is no product analytics pipeline for the platform operator itself (no cross-tenant reporting).

## Non-goals for the current release

Replacing a full CRM or helpdesk; a marketplace of third-party integrations; on-premise installation packaging; a mobile
app; a public API with API keys for third-party developers.
