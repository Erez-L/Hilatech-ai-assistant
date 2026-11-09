# Deployment

Target: a single Linux host with Docker (scales later to Kubernetes — every service is stateless
except Postgres and Redis).

1. Create `/opt/hilatech/.env` from `.env.example` with production values: strong `JWT_*` secrets,
   `COOKIE_SECURE=true`, `CORS_ORIGINS=https://app.example.com`, `APP_URL`, `API_URL`, SMTP settings,
   `CREDENTIALS_ENCRYPTION_KEY`, provider API keys (optional).
2. Copy `docker-compose.prod.yml` and `Caddyfile` next to it; set `GITHUB_REPOSITORY`, `IMAGE_TAG`,
   `APP_DOMAIN`, `POSTGRES_PASSWORD`, `DATABASE_URL` in `.env`.
3. `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`.
   The `migrate` one-shot service runs `prisma migrate deploy` before the API starts.
4. Verify: `https://APP_DOMAIN/api/v1/health/ready`, then log in.

## Backups

- PostgreSQL: nightly `pg_dump -Fc` to object storage (`infrastructure/monitoring/backup.sh` template)
  plus WAL archiving if RPO < 24h is required.
- Redis holds queues only; persistence is enabled (AOF) but data is reconstructible.
- Uploaded documents live in object storage (`STORAGE_DRIVER=s3`) — use bucket versioning.

## Monitoring hooks

Structured JSON logs (pino) from every service → ship with the Docker logging driver of your choice.
Health endpoints: API `/api/v1/health`, `/api/v1/health/ready`; workers `:4100/health`. Metrics
integration points are documented in `infrastructure/monitoring/README.md`.
