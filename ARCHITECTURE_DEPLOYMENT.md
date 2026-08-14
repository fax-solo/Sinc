# Deployment Architecture

## Environments

| Environment     | Purpose                              | Credentials                     | Data                  |
| --------------- | ------------------------------------ | ------------------------------- | --------------------- |
| **development** | Local dev, fast iteration            | Dev keys, sandbox providers     | Anonymized fixtures   |
| **staging**     | Pre-prod validation, E2E, load tests | Staging keys, sandbox providers | Synthetic data        |
| **production**  | Real users                           | Real keys, secret manager       | Real data (backed up) |

No environment shares secrets or data. `.env.development`, `.env.staging`, `.env.production` (or env injection via CI/secrets).

## Development Environment

### Local Stack (docker-compose.dev.yml)

```
services:
  postgres:   postgres:16 (port 5432)
  redis:      redis:7 (port 6379)
  minio:      minio/minio (ports 9000/9001, S3-compatible)
  api:        local via npm run dev (host, port 3000)
  worker:     local via npm run worker (separate process)
  mailpit:    mailpit/mailpit (port 8025) — local email catching
  adminer:    adminer (port 8080) — DB GUI (dev only)
```

Run: `docker compose -f docker/dev/docker-compose.dev.yml up -d` then `npm run dev` (API) + `npm run worker`.

### Mobile Dev

- Metro bundler for RN
- `adb reverse tcp:3000 tcp:3000` (Android emulator → host API)
- iOS simulator uses `http://localhost:3000`
- Physical devices: use LAN IP + `.env` base URL override
- SSL for dev: self-signed cert accepted in debug build only

## Staging Environment

- Mirrors production topology but smaller
- Deployed via CI on merge to `staging` branch
- Uses sandbox provider endpoints + synthetic data
- Runs nightly E2E + load tests
- Enables full logging, Sentry staging DSN

## Production Architecture

### Initial Deployment (MVP, low cost)

```
                    ┌─────────────────────────┐
                    │  Cloudflare CDN + TLS   │
                    │  (static + API edge)    │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │     Load Balancer       │
                    │   (ALB / Caddy / Nginx) │
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼───────┐      ┌────────▼────────┐     ┌────────▼────────┐
│  API Server   │      │   API Server    │     │  API Server     │
│  (x2-3, stateless)   │  (auto-scaled)  │     │  (auto-scaled)  │
└───────┬───────┘      └────────┬────────┘     └────────┬────────┘
        │                       │                       │
        └──────────┬────────────┴────────────┬──────────┘
                   │                         │
        ┌──────────▼──────────┐     ┌────────▼──────────┐
        │     PostgreSQL 16   │     │      Redis 7      │
        │  (primary + replica)│     │  (cache, queue,   │
        └─────────────────────┘     │   pub/sub, rate)  │
                                    └───────────────────┘
                   │                         │
        ┌──────────▼──────────┐     ┌────────▼──────────┐
        │  Object Storage     │     │    Workers        │
        │  (S3/MinIO)         │     │  (download,       │
        └─────────────────────┘     │   lyrics, recs,   │
                                    │   notifications)  │
                                    └───────────────────┘
        ┌──────────▼──────────┐
        │  Prometheus +       │
        │  Grafana + Loki     │
        └─────────────────────┘
```

### Containerization

```dockerfile
# Dockerfile (backend, multi-stage)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --production

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

- Separate images: `sinc-api`, `sinc-worker` (same build, different `CMD`/entrypoint)
- Images pushed to registry (GHCR/ECR)
- Trivy scan in CI before push

### Orchestration Options

**Option A — Docker Swarm / docker-compose on a few VMs (cheapest MVP)**

- 2–3 VMs behind load balancer
- API + worker as services
- Managed PostgreSQL/Redis or self-hosted containers

**Option B — Kubernetes (managed, e.g., EKS/GKE/K3s)**

- For horizontal scaling from day 1
- HPA on API (CPU/latency), workers scaled on queue depth
- NetworkPolicy, secrets via external secret operator
- Recommended when team comfortable with k8s

**Option C — Platform services (Render/Fly/Railway)**

- Fastest to MVP; good observability
- Workers as separate processes/services
- Managed Postgres + Redis

### Provisioning (Infra as Code)

- Terraform (or Pulumi) for cloud resources
- Docker-compose for local/staging small deployments
- Ansible for config drift on VMs (if Option A)

## CI/CD Pipelines

### Backend Pipeline (GitHub Actions)

```
push → lint → typecheck → unit tests → integration tests (Testcontainers)
     → build image → trivy scan → push image
merge to main → deploy staging → e2e tests (staging) → smoke test
tag vX.Y.Z → deploy production (blue/green or rolling)
```

### Mobile Pipeline

```
push → lint → typecheck → jest unit → build (android apk/ios)
     → (PR) Detox on simulator → (tag) build + sign → upload to:
       Android: Play Console (internal/closed track)
       iOS: App Store Connect (TestFlight)
```

### Environment Promotion

- Development: automatic on commit (feature branch)
- Staging: on merge to `staging` branch
- Production: on tag/release (manual approval required)

## Database Migrations

- Prisma migrations committed to repo
- CI runs `prisma migrate deploy` on staging before deploying app
- Production: migrations run in a deploy step before new API rollout (backward-compatible migrations only)
- Zero-downtime strategy: additive migrations + expand-contract pattern (e.g., add column nullable → backfill → make required in later release)
- Rollback: restore from backup if migration fails (tested restore procedure)

## Observability Stack

| Tool          | Purpose                                     |
| ------------- | ------------------------------------------- |
| Prometheus    | Metrics (API, DB, Redis, queues, providers) |
| Grafana       | Dashboards + alerts                         |
| Loki          | Log aggregation (Pino structured logs)      |
| Sentry        | Error + performance (backend + mobile)      |
| Uptime checks | External availability (status page)         |
| OpenTelemetry | Distributed traces (optional MVP+)          |

Dashboards:

- API: RPS, p95 latency, error rate by route
- DB: connections, slow queries, replication lag
- Redis: memory, hit rate, queue depth
- Workers: processed, failed, stalled, heartbeat
- Providers: success rate, latency, circuit states
- Downloads: started/completed/failed/throughput per hour
- Mobile: active users, crash-free rate, session length

## Backups & Disaster Recovery

- **PostgreSQL**: daily pg_dump + WAL archiving (5-min) to object storage; 30-day retention; encrypted
- **Redis**: AOF enabled + scheduled snapshots; cache loss is non-fatal (rebuild)
- **Object storage**: versioning + cross-region replication (optional); lifecycle for temp files
- **Restore drill**: monthly automated restore to a scratch DB + integrity check
- **RPO**: ≤ 5 min (WAL). **RTO**: ≤ 1 hour (restore + scale)

## Security in Deployment

- Secrets via secret manager; no secrets in images/CI logs
- Minimal IAM roles per service (API: DB/Redis/Storage/SES only)
- Network: private subnets for DB/Redis; only API exposed
- Firewall/security groups restrict ports
- Container images non-root user
- Regular dependency + base-image updates (Dependabot/Renovate)
- Audit: deploy logs, image provenance (SBOM)

## Scaling Triggers

| Signal                       | Action                              |
| ---------------------------- | ----------------------------------- |
| API p95 > 300ms sustained    | Scale API horizontally              |
| Queue depth > 1000 sustained | Scale workers (add replicas)        |
| DB CPU > 70%                 | Add read replica, optimize queries  |
| Redis memory > 70%           | Tune TTLs, add memory               |
| Storage growth > forecast    | Add lifecycle policies, audit sizes |

## Release Process

1. Feature branch → PR → CI (lint/test/build) → review → merge to `main`
2. `main` auto-deploys to staging + runs E2E
3. Release candidate tag → staging soak (24h) + load test
4. Manual approval → blue/green deploy to production
5. Smoke tests post-deploy (health, search, login, download)
6. Feature flags control gradual rollout (e.g., new search ranking to 10% → 50% → 100%)
7. Monitor dashboards/alerts; rollback = repoint load balancer to previous green

## Cost Control

| Area          | Strategy                                                                                |
| ------------- | --------------------------------------------------------------------------------------- |
| Compute       | Auto-scale down at night for non-prod; reserved instances for steady-state              |
| Storage       | Lifecycle policies; delete temp files (24h); artwork CDN caching; dedupe object uploads |
| Data transfer | Cloudflare CDN for artwork/static; signed URL caching                                   |
| Providers     | Aggressive cache TTLs; circuit breakers; free/open sources preferred                    |
| Observability | Retention limits on logs/metrics; sample traces                                         |
| Mobile push   | Batch recommendations (weekly) not per-event; preference defaults off for non-critical  |

## Environment Configuration Checklist

- [ ] `.env.example` committed with placeholders
- [ ] All secrets injected (never committed)
- [ ] Provider keys: sandbox in dev/staging, production in prod
- [ ] Sentry DSN per environment
- [ ] Feature flags per environment
- [ ] CORS: dev `*`, prod restricted to app domains
- [ ] Certificates: dev self-signed (debug), staging/prod real TLS
