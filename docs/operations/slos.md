# Service level objectives (proposed)

**Proposed targets for a first production launch, not commitments and not measured.** There is no traffic history,
so every number is a starting point to be reviewed after 4 weeks of real data. SLIs are chosen so that the metrics
already exist in the stack (ALB, ECS, RDS, CloudWatch Logs); nothing here requires new code unless marked _(needs
instrumentation)_.

| #   | Service                  | SLI (how measured)                                                                      | Proposed SLO                                                                          | Window       | Alarm / source                                                                                                                                   |
| --- | ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | API availability         | `1 - (ALB target 5xx / ALB requests)` for `/api/*`                                      | >= 99.5%                                                                              | 30 d rolling | `AlbTarget5xx` alarm (count-based early warning); ratio from ALB metrics                                                                         |
| 2   | API latency              | p95 `TargetResponseTime` on the API target group, **excluding streaming/SSE endpoints** | p95 <= 2 s (non-AI endpoints)                                                         | 30 d         | `ApiLatencyP95` alarm (threshold 2 s) - AI endpoints are excluded because model latency dominates _(needs per-route metric to exclude properly)_ |
| 3   | Web availability         | web target group healthy-host ratio and 5xx                                             | >= 99.5%                                                                              | 30 d         | `WebUnhealthyHosts`                                                                                                                              |
| 4   | Authentication success   | login endpoint 2xx / (2xx + 5xx)                                                        | >= 99.9% of non-4xx outcomes                                                          | 30 d         | _(needs route-level metric; derive from logs with Logs Insights)_                                                                                |
| 5   | Background job freshness | age of oldest waiting BullMQ job per queue                                              | < 5 min p95 for interactive queues (e.g. knowledge ingestion start, webhook delivery) | 7 d          | _(needs instrumentation: queue-depth/age metric is not published)_                                                                               |
| 6   | AI request success       | `AiRequestLog.status = success` / total, per provider                                   | >= 98% excluding 4xx user errors                                                      | 7 d          | usage data already in Postgres (`/ai/usage`); provider incidents will dominate                                                                   |
| 7   | Data durability          | successful restore test                                                                 | quarterly restore drill passes within RTO                                             | quarterly    | see `backup-recovery.md`                                                                                                                         |
| 8   | Backup freshness         | newest RDS automated backup / AWS Backup recovery point age                             | < 26 h (daily)                                                                        | continuous   | AWS Backup job failure events _(add an EventBridge rule -> SNS: not built)_                                                                      |

## Error budget policy (proposal)

- 99.5% over 30 days = about 3 h 36 min of allowed unavailability per 30 days (`0.005 x 43,200 min = 216 min`).
- If more than 50% of the 30-day budget is consumed, freeze non-critical deploys until a post-incident review is done.
- Staging/dev have no SLO.

## Notes

- ALB 5xx counts only errors the targets return or the ALB generates for target failures; client 4xx are excluded.
- A single-AZ database (dev/staging) cannot meet #1 at 99.5% through an AZ failure; **prod is Multi-AZ**.
- SLO targets for AI providers are bounded by the provider's own availability and by account quotas
  (throttling returns `rate_limited`, which the orchestrator retries within budget).
