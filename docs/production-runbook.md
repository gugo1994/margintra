# Margintra production runbook

## Topology and prerequisites

The supported provider-neutral topology is:

```text
Internet → trusted HTTPS reverse proxy → 127.0.0.1:WEB_PORT (nginx) → NestJS API
                                                └──────────────→ static web assets
NestJS API → PostgreSQL, Redis, Stripe, Resend
```

Only the HTTPS reverse proxy should reach the web port. PostgreSQL, Redis, and the API have no host ports in `docker-compose.production.yml`. Block `/metrics` at the outer proxy except from the monitoring network. Keep `/health/live` and `/health/ready` available to the load balancer.

API replicas are stateless and do not require sticky sessions. Run identical replicas with the same PostgreSQL, Redis, JWT, Stripe-encryption, and email configuration. PostgreSQL coordinates ingestion idempotency, Stripe webhook reservations, usage replay claims, notification delivery claims, and financial updates. Redis provides the shared ingestion rate limiter. Each replica exposes process-local Prometheus counters at `/metrics`; the monitoring system must discover and scrape every replica rather than scraping only the load-balancer address.

Forward a valid `X-Request-Id` when one already exists or allow each replica to generate one. The API returns the effective identifier in `X-Request-Id`, including error responses. Do not use request IDs for authorization or idempotency.

The outer proxy must terminate HTTPS, redirect HTTP to HTTPS, set HSTS after validation, and replace—not append untrusted client values for—`Host`, `X-Forwarded-Proto: https`, and `X-Forwarded-For`. nginx appends the trusted proxy hop before forwarding to NestJS. `TRUST_PROXY_HOPS=2` intentionally trusts exactly the outer proxy and nginx; change it only when the proxy topology changes. Direct access to nginx would invalidate this trust assumption and must be blocked by host/network policy.

## Required environment

Copy `.env.example` to a deployment-owned file outside version control and set:

- `APP_ENV=production`
- `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_USER`
- `JWT_SECRET` with at least 32 random bytes
- stable `BILLING_ENCRYPTION_KEY` generated with `openssl rand -base64 32`
- public HTTPS `WEB_ORIGIN` and `MARGINTRA_DASHBOARD_URL`
- `TRUST_PROXY_HOPS=2` for the documented two-proxy topology
- Resend `EMAIL_API_KEY`, verified `EMAIL_FROM_EMAIL`, and `EMAIL_FROM_NAME`
- immutable `IMAGE_TAG` identifying the release
- optional loopback `WEB_PORT`

Production rejects demo seeding, HTTP public URLs, a development email gateway, malformed dependency URLs, weak JWT secrets, and invalid Stripe encryption keys. Never rotate the Stripe encryption key without a credential re-encryption plan.

Redis is non-authoritative operational state for the shared rate limiter. PostgreSQL remains the source of truth for accepted usage, pricing, revenue history, webhook reservations/retries, and notification delivery. Loss of Redis must fail readiness and may reset rate-limit windows after recovery, but must not lose accepted financial data.

## PostgreSQL connection budget

Each API replica has an explicit `DB_POOL_MAX` connection limit (default `10`). The one-shot migration process uses the same limit only while migrations run. Choose the replica count and pool size so:

```text
replica_count × DB_POOL_MAX < PostgreSQL max_connections - reserved_headroom
```

Reserve at least 20% of `max_connections` (and never fewer than 10 connections) for migrations, administration, monitoring, and recovery. For PostgreSQL's common `max_connections=100`, a safe starting point is 3 API replicas with `DB_POOL_MAX=10`: 30 possible API connections, leaving 70 connections of headroom. Increase the pool only after observing pool wait time and database saturation; adding replicas multiplies the connection budget.

Start with `DB_POOL_IDLE_TIMEOUT_MS=30000`, `DB_POOL_CONNECTION_TIMEOUT_MS=5000`, and 5-second usage/notification worker intervals. Every API replica runs both lightweight workers; increasing the intervals reduces idle database polling at the cost of replay/notification latency.

## Build, backup, migrate, and start

Use the same explicit environment file for every command:

```bash
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml build
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml up -d postgres redis
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml exec -T postgres \
  pg_dump -U margintra -d margintra -Fc > margintra-before-deploy.dump
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml run --rm migrate
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml up -d api-nest web
```

The migration container runs the compiled `node dist/database/migrate.js` command, exits, and closes its database connection before the API starts. Production API startup uses `synchronize=false` and `migrationsRun=false`. Full `docker compose up -d` is also safe: the API waits for the one-shot migration service to complete successfully.

## AI pricing catalog operations

Pricing changes use a database-credentialed CLI; there is no public or customer-facing operator endpoint. Run migrations first. Every mutation requires an auditable `--operator-source`, such as an internal change ticket.

```bash
npm run pricing:catalog -- list-active
npm run pricing:catalog -- list-pending

npm run pricing:catalog -- create \
  --provider openai \
  --model gpt-new-model \
  --canonical-model gpt-new-model \
  --input-price-per-million 1.25000000 \
  --output-price-per-million 10.00000000 \
  --currency USD \
  --effective-from 2026-09-01T00:00:00Z \
  --source-type verified_manual \
  --source-reference pricing-review-2026-09 \
  --operator-source CHANGE-1234

npm run pricing:catalog -- activate --id <pricing-uuid> --operator-source CHANGE-1234
npm run pricing:catalog -- retire --id <pricing-uuid> --operator-source CHANGE-1234
```

Creation produces a pending version unless identical pricing facts already exist. Activation closes the preceding active range and requeues only `pending_pricing` usage covered by the new effective range. The usage worker performs financial processing asynchronously after the activation transaction commits.

## Verify

From the deployment host:

```bash
curl --fail http://127.0.0.1:${WEB_PORT:-8080}/health/live
curl --fail http://127.0.0.1:${WEB_PORT:-8080}/health/ready
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml ps
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml logs --tail=200 api-nest web
```

Then verify the public HTTPS login and ensure HTTP redirects to HTTPS. Configure Stripe webhooks as `https://PUBLIC_HOST/api/v1/webhooks/stripe/{connectionIdentifier}` using the organization-specific path shown by Margintra. Store Stripe webhook signing secrets only through the integration UI/API. Resend will reject production mail until the sender address/domain is verified.

## Launch checklist

1. Provision production PostgreSQL and Redis with private network access and monitoring.
2. Configure deployment-owned environment secrets and public HTTPS URLs; do not store the environment file in version control.
3. Create a Stripe restricted key with **Read** access only for Accounts, Customers, Subscriptions, Prices, and Products.
4. Back up the database, then run the one-shot `migrate` service and require a successful exit before application startup.
5. Start the API/workers and frontend from the same immutable `IMAGE_TAG`.
6. Create the organization-specific Stripe webhook endpoint and store its `whsec_...` secret in Margintra.
7. Verify the configured Resend sender address/domain in Resend before enabling email notifications.
8. Check `/health/live` and `/health/ready`; restrict `/metrics` to the monitoring network and confirm every API replica is scraped.
9. Create a dedicated launch-test organization and ingestion API key.
10. Send one non-sensitive, real-safe usage event to `/api/v1/ingest/usage` and confirm the API returns `202` only after durable acceptance.
11. Verify the usage inbox worker advances that event from pending to processed (or to visible `pending_pricing` when pricing is unavailable).
12. Verify the expected customer cost and profitability update appears in the dashboard.
13. Review correlated API/worker logs and the ingestion, backlog, pricing, Stripe-retry, and notification metrics without exposing payloads or credentials.
14. Rotate or revoke the launch smoke-test ingestion key if it is temporary.

## Credential rotation

- **Ingestion keys:** use **Rotate key** in Integrations, update the server-side deployment secret immediately, and confirm the old key is revoked. Plaintext keys cannot be recovered.
- **JWT secret:** deploy the new secret consistently to every API replica; existing sessions become invalid and users must authenticate again.
- **Resend API key:** replace it in the deployment secret store, restart API replicas, verify delivery, then revoke the prior provider key.
- **Stripe restricted key:** reconnect through Margintra with a replacement restricted key that has the approved Read permissions, verify synchronization, then retire the old key in Stripe.
- **Stripe webhook secret:** update the secret through Margintra when replacing the Stripe endpoint; never log or place the `whsec_...` value in source control.
- **Stripe encryption key:** do not rotate `BILLING_ENCRYPTION_KEY` in place. A credential re-encryption procedure is required before changing it or stored Stripe credentials will become unreadable.

## Rollback

1. Stop web/API without deleting volumes: `docker compose ... stop web api-nest`.
2. Set `IMAGE_TAG` to the previous immutable application image.
3. If the previous application is compatible with the migrated schema, start it and verify readiness.
4. If a migration is incompatible, stop all writers, restore the pre-deploy dump into a clean target database, then start the previous image. Do not attempt ad-hoc reverse SQL against production.

TypeORM migrations are forward-only for normal deployment. Database restoration is the recovery mechanism for incompatible schema rollback.

## Restore drill

Test restores regularly in an isolated environment:

```bash
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml stop api-nest web
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml exec -T postgres \
  dropdb -U margintra --if-exists margintra_restore
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml exec -T postgres \
  createdb -U margintra margintra_restore
docker compose --env-file /secure/path/margintra.env -f docker-compose.production.yml exec -T postgres \
  pg_restore -U margintra -d margintra_restore --clean --if-exists < margintra-before-deploy.dump
```

Validate the restored database using an isolated API instance before promoting it. Encrypt backups, restrict access, define retention, and monitor backup completion outside Margintra.

## Authentication and browser security

Margintra uses bearer JWTs in the `Authorization` header; it does not use authentication cookies, so cookie `Secure`/`SameSite` settings and cookie-CSRF handling do not apply. CORS permits only the exact `WEB_ORIGIN` and never enables credentials. The nginx image adds CSP, frame-ancestor, MIME-sniffing, and referrer protections. Because the current web client stores its JWT in browser local storage, preventing script injection and serving only trusted immutable assets over HTTPS remain critical.
