# ShipSafe Flags (v1 scaffold)

A small but production-style feature flag control plane + evaluation API with a React admin UI.

## Stack
- TypeScript monorepo (`apps/api`, `apps/web`)
- Node.js + Express API
- React + Vite frontend
- PostgreSQL 17 (source of truth)
- Docker + Docker Compose
- GitHub Actions CI

## Architecture

```text
+-------------------+            +---------------------+
| React Admin UI    | --SSE----> | API /api/admin/stream |
| - list/create/edit|            |                     |
| - evaluate panel  | --REST---> | Admin API + Eval API|
+-------------------+            | - validation        |
                                 | - optimistic lock   |
                                 | - in-memory cache   |
                                 +----------+----------+
                                            |
                                            v
                                   +------------------+
                                   | PostgreSQL 17    |
                                   | flags/env config |
                                   | audit history    |
                                   +------------------+
```

## Targeting + rollout controls (v1)

Each environment (`dev`, `staging`, `prod`) has its own config, so environment scoping is `enabled` per environment; evaluation requests must include `environment`.

### Evaluation flow and precedence
Implemented in `apps/api/src/evaluator.ts`:
1. `killSwitch=true` => off
2. `enabled=false` for the requested environment => off
3. **Deny rules** (hard off): `denylist` (userId), `denyEmails`, `denyEmailDomains`
4. **Allow rules** (hard on, environment still respected): `allowlist` (userId), `allowEmails`, `allowEmailDomains`
5. Attribute rules (equals/in) must all pass
6. Deterministic percentage rollout (`percentageRollout`, integer 0..100)
7. Default => on

Deny always beats allow; allow beats rollout. Rollout buckets by a stable key: `userId`, else `email` (lowercased), else `anonymousId`. With no identifier the flag is off unless rollout is 100.

### Example payloads
```json
PUT /api/admin/flags/new-checkout/environments/prod
{
  "actor": "alice", "reason": "gradual rollout", "expectedVersion": 1,
  "config": {
    "enabled": true, "killSwitch": false,
    "allowlist": ["user_123"], "denylist": [],
    "allowEmails": ["qa@example.com"], "denyEmails": [],
    "allowEmailDomains": ["example.com"], "denyEmailDomains": ["spam.test"],
    "attributeRules": [], "percentageRollout": 25, "salt": "new-checkout-prod"
  }
}

POST /api/evaluate
{ "flagKey": "new-checkout", "environment": "prod",
  "context": { "userId": "user_1", "email": "a@example.com", "anonymousId": "anon-9" } }
```
Validation failures return `400 {"error":"validation_error","details":[{"path":"...","message":"..."}]}` (rollout outside 0..100, unknown environment, malformed email/domain, an entry in both allow and deny).

### Evaluation audit logging
Every `/api/evaluate` call emits one JSON log line: `type`, `flagKey`, `environment`, `identifierType`, `identifier`, `matchedRule` (`deny|allow|rollout|none`), `decision`, `reason`, `timestamp`. Emails are masked (`j***@example.com`).

### Migration / backward compatibility
No DB migration is needed (configs are JSONB). Existing configs without `percentageRollout` behave as 100%, without email/domain lists as empty lists; an environment with no stored config is treated as enabled at 100%. Existing endpoints are unchanged, except that 400 validation errors are now structured as above.

## Vertical slice shipped
1. Create a flag (`POST /api/admin/flags`)
2. Evaluate flag (`POST /api/evaluate`)
3. Update env config with optimistic concurrency (`PUT /api/admin/flags/:key/environments/:env`)
4. UI updates near-real-time through SSE

## Data model / migrations
Migration: `apps/api/migrations/001_init.sql`
- `flags`
- `flag_environment_configs` (`dev|staging|prod`, `version`, `config` JSONB)
- `flag_environment_audit` (before/after snapshots)

## Caching + invalidation strategy
- Read-through in-memory cache keyed by `(flagKey, environment)`
- TTL: 30s
- Invalidate on every create/update
- SSE event broadcasts config change so admin clients refresh immediately
- If invalidation event is missed, TTL guarantees eventual correction

## Rollback/audit explanation
- Every update writes immutable audit rows with `before_config` and `after_config`
- Rollback UI endpoint is not implemented yet, but history snapshots make rollback straightforward by writing an older `after_config` as a new version

## Incident coverage in v1
- **Bad rollout to all users**: `killSwitch` at env level + audit trail to identify change
- **Two editors collision**: `expectedVersion` check returns `409 version_conflict`
- **Stale cache after rollback/update**: immediate invalidation + TTL safety net
- **Backend restart during config changes**: Postgres is source of truth; cache rebuilds from DB
- **High eval traffic**: stateless eval endpoint + memory cache avoids DB read per request

## RBAC (simple)
Header-based role checks:
- `viewer`: read-only
- `developer`: create/update non-prod
- `admin`: required for prod updates

## Why companies care
| Feature | Why needed | Incident/risk prevented | Trade-off |
|---|---|---|---|
| Emergency stop (`killSwitch`) | Immediate blast-radius control | Broken rollout stays live too long | Can be overused instead of root-cause fixes |
| Deterministic percentage rollout | Consistent user experience | User flapping between on/off | Requires stable user identity |
| Optimistic concurrency | Safe collaboration | Silent overwrite of teammate edits | UI must handle 409 conflicts |
| Audit history | Compliance + forensics | No answer to "who changed prod?" | Storage overhead |
| Environment-specific config | Safer promotion path | Dev rules accidentally hitting prod | More config surface to manage |
| SSE updates | Faster incident response in UI | Operators working on stale state | One-way channel only |

## How this differs from a toy feature flag demo
- Versioned environment configs with optimistic concurrency
- Explicit precedence with deterministic rollout hashing
- Audit trail snapshots for every change
- Role-gated production updates
- SSE near-real-time refresh
- Caching + invalidation strategy documented and implemented
- Unit + integration tests + CI workflow

## Benchmark approach/results (initial)
Approach:
- Evaluate pure rule engine in-process (hash + rule checks) to estimate raw evaluator cost
- Then benchmark HTTP endpoint with warm cache (`autocannon` recommended)

Initial local micro-benchmark (pure evaluator loop, 100k evals):
- ~598k evaluations/sec on GitHub-hosted Linux runner class CPU equivalent
- HTTP performance depends on deployment and is expected to be lower

## Benchmark approach/results (updated)

**Approach**
- Executed mixed-path load testing with k6 against the local Docker deployment:
  - `POST /api/evaluate` (evaluation hot path)
  - `GET /api/admin/flags` (admin read path)
  - `PUT /api/admin/flags/:key/environments/:env` (concurrent write path with optimistic concurrency)
- Scenario mix: **48 total VUs**  
  - 30 VUs evaluate for 60s  
  - 15 VUs read for 45s (staggered start)  
  - 3 VUs write for 45s (staggered start)
- Seeded benchmark data (`bench-flag`) and ran tests from Windows using Dockerized k6.

**Results (local baseline — July 9, 2026)**
- Completed approximately **380K–416K requests in 60 seconds** across the mixed workload runs.
- Observed **0 interrupted iterations** in completed runs.
- Verified concurrent update behavior under write contention with optimistic concurrency controls (conflict-safe update semantics).

**Notes**
- These are **local development baselines** (Windows + Docker Desktop), not production SLA guarantees.
- Throughput and latency will vary by machine resources, container runtime settings, network path, and Postgres tuning.
- For production-grade benchmarking, run the same k6 scenarios in an environment that mirrors production infrastructure.

## Local dev
```bash
npm ci
npm run -w apps/api test
npm run -w apps/web build
docker compose up --build
```

Open:
- UI: http://localhost:5173
- API: http://localhost:3000

## API quick examples
```bash
curl -X POST http://localhost:3000/api/admin/flags \
  -H 'content-type: application/json' -H 'x-role: developer' \
  -d '{"key":"new-checkout","name":"New Checkout","description":"","actor":"alice"}'

curl -X POST http://localhost:3000/api/evaluate \
  -H 'content-type: application/json' \
  -d '{"flagKey":"new-checkout","environment":"dev","context":{"userId":"user_1","attributes":{"country":"US"}}}'
```
