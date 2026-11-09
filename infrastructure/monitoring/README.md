# Observability

| Signal   | Source                                                      | Notes                                                                                                                         |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Logs     | pino JSON from api/workers/web                              | Fields: `level`, `time`, `requestId`, `userId`, `organizationId`, `jobId`, `queue`. Secrets redacted (`SENSITIVE_LOG_PATHS`). |
| Health   | `/api/v1/health`, `/api/v1/health/ready`, workers `/health` | Readiness checks Postgres + Redis.                                                                                            |
| Errors   | `HttpExceptionFilter` logs 5xx with stack + requestId       | Plug Sentry/OpenTelemetry exporter in `apps/api/src/common/observability` (integration point).                                |
| Queues   | workers `/health` → per-queue counts                        | Alert when `failed` grows or `waiting` exceeds a threshold for 10 minutes.                                                    |
| AI usage | `AiUsageLog` (Priority 3)                                   | Tokens, duration, provider, model per org/user/agent.                                                                         |

Suggested stack: Grafana Loki (logs) + Prometheus (scrape a future `/metrics` endpoint) + Alertmanager.
