# Public Form Logger

> Independent backup logger for **Attendee** public landing-page form submissions.
> A standalone NestJS service with its own PostgreSQL database, an admin UI,
> and a public ingestion endpoint built to be **fast, idempotent, and impossible
> to confuse with the main Attendee API**.

---

## Why this service exists

When a user submits a form on a landing page (e.g. `choyou.fr`, `itforbusiness.fr`),
the frontend fires **two parallel requests**:

1. `POST /public-form-logs` → **Public Form Logger** (best-effort safety net)
2. `POST /public/<token>/register` → **Attendee API** (authoritative inscription)

If Attendee fails for any reason — DB issue, deploy in progress, validation
quirk — the raw form data is still preserved here, ready to be replayed manually
from the admin UI.

The Logger is **best-effort** and **must never block** the call to Attendee.
See [`context/architecture/overview.md`](context/architecture/overview.md).

---

## Stack

- **Node** 20 LTS
- **NestJS** 10
- **PostgreSQL** 16
- **Prisma** 5
- **EJS** for the (very minimal) admin UI
- **bcrypt** + **JWT cookie httpOnly** for admin auth
- **Docker** + **docker-compose** for local dev and prod

---

## Repository layout

```
src/        NestJS source code
prisma/     Prisma schema + migrations
views/      EJS templates (admin UI)
public/     Static assets served at /admin/*
tests/      End-to-end tests
scripts/    Operational scripts (seed, backup)
docs/       User-facing / operational documentation
context/    Architecture, ADRs, constraints, playbooks
temp/       Throwaway files (gitignored)
archives/   Old/deprecated artifacts (kept for reference)
```

The full project structure rules live in
[`context/constraints/project-structure.md`](context/constraints/project-structure.md).

---

## Quick start (Docker — the only supported workflow)

> The service is designed to run inside `docker compose`. Both the API and its
> Postgres live in containers; you should not run `npm run start:dev` against
> a host Postgres except for transient debugging.

From the repo root:

```bash
# 1. Configure environment
cp .env.docker.example .env.docker    # used by the API container
cp .env.example .env                  # only needed if you run Prisma CLI from the host

# 2. EDIT .env.docker. Mandatory:
#    - JWT_SECRET (>= 32 chars)
#    - ADMIN_EMAIL / ADMIN_PASSWORD
#    - CORS_ORIGINS (comma-separated)
#    - POSTGRES_PASSWORD

# 3. Build + start the stack (Postgres + API)
docker compose up -d --build

# 4. Wait until the API is healthy, then seed the admin user (first run only)
docker compose exec api node dist/scripts/seed-admin.js

# 5. Hit it
curl http://localhost:4001/health
# {"status":"ok"}

# 6. Stop the stack (keeps the Postgres volume)
docker compose down

# 7. Wipe everything (incl. the Postgres volume — destructive)
docker compose down -v
```

Useful ops:

```bash
docker compose logs -f api              # follow API logs
docker compose logs -f postgres         # follow DB logs
docker compose exec api sh              # shell inside the API container
docker compose exec api npx prisma migrate deploy   # re-apply migrations
```

**Default ports**:

| What | Host port | In-container |
|---|---|---|
| API + admin UI | `4001` | `4001` |
| Postgres (Logger) | `5433` | `5432` |

The Postgres host port is `5433` to avoid clashing with Attendee's own Postgres
on `5432`. You can connect with DBeaver/TablePlus on `localhost:5433`.

---

## Local debug (without Docker) — advanced, not the default path

Only use this when you need to step-debug or attach a profiler.
It requires Node 20 + a Postgres 16 reachable from your host (typically the
Docker Postgres exposed on `localhost:5433`).

```bash
cp .env.example .env
# edit .env

npm install
npm run prisma:migrate:dev
npm run seed:admin
npm run start:dev
```

For every other situation, use `docker compose up --build`.

---

## Public ingestion endpoint

`POST /v1/public-form-logs`

### Request

```json
{
  "public_token": "AbCdEfGhIjKlMnOp",
  "submission_id": "uuid-from-frontend-or-omitted",
  "form_payload": {
    "email": "user@example.com",
    "name": "Alice",
    "company": "ACME"
  },
  "landing_page_url": "https://choyou.fr/landing",
  "utm_source": "newsletter",
  "utm_medium": "email",
  "utm_campaign": "spring-2026"
}
```

### Validation

- `public_token` — required, 8–128 chars, `[A-Za-z0-9_-]`
- `submission_id` — optional but **strongly recommended** (used as idempotency key)
- `form_payload` — required object, **non-empty**, ≤ 32 KB serialized,
  ≤ 100 top-level keys
- HTTP body limit: 100 KB

### Responses

| Status | Body | When |
|---|---|---|
| `201 Created` | `{ "status": "created", "id": "<uuid>" }` | New log inserted |
| `200 OK`      | `{ "status": "duplicate", "id": "<existing uuid>" }` | `submission_id` already exists |
| `400 Bad Request` | validation error | Malformed body, empty payload, etc. |
| `429 Too Many Requests` | rate-limit error | IP or token bucket exceeded |
| `503 Service Unavailable` | error | DB unreachable — frontend should retry |

### Frontend retry policy (recommended)

When the Logger returns `5xx` or a network error, retry **1 to 3 times** with
exponential backoff (`500ms → 1000ms → 2000ms`). After all retries fail, **do
not block the user** — proceed with the Attendee call regardless. The Logger is
a safety net, not a gate.

### curl example

```bash
curl -X POST http://localhost:4001/v1/public-form-logs \
  -H 'Content-Type: application/json' \
  -d '{
    "public_token": "AbCdEfGhIjKlMnOp",
    "submission_id": "11111111-2222-3333-4444-555555555555",
    "form_payload": { "email": "alice@example.com", "name": "Alice" },
    "landing_page_url": "https://choyou.fr/landing",
    "utm_source": "newsletter"
  }'
```

---

## Admin

| Endpoint | Purpose |
|---|---|
| `GET /admin` | Redirects to `/admin/login` or `/admin/dashboard`. |
| `GET /admin/login` | Login form (EJS). |
| `POST /admin/auth/login` | Issues an httpOnly JWT cookie. **Rate-limited: 5/15 min/IP.** |
| `POST /admin/auth/logout` | Clears the session cookie. |
| `GET /admin/dashboard` | List of logs + filters + stats. |
| `GET /admin/logs/:id` | Detail page with full payload + copy-JSON button. |
| `GET /admin/public-form-logs` | JSON list (paginated, filterable). |
| `GET /admin/public-form-logs/:id` | JSON detail. |
| `GET /admin/stats` | `{ last24h, last7d, lastReceivedAt }`. |

The admin user is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` via:

```bash
# inside the API container
docker compose exec api node dist/scripts/seed-admin.js                       # first time
docker compose exec api node dist/scripts/seed-admin.js --reset-password      # overwrite

# or, locally without Docker
npm run seed:admin
npm run seed:admin -- --reset-password
```

---

## Health checks

```bash
curl http://localhost:4001/health        # {"status":"ok"}
curl http://localhost:4001/health/ready  # {"status":"ok","db":"up"}
```

`/health/ready` runs a `SELECT 1` against Postgres — use it for readiness probes.

---

## Security highlights

- **CORS** — `CORS_ORIGINS` is a comma-separated list of:
  - bare domains (allow exact host AND any subdomain), e.g. `choyou.fr`
  - explicit origins with scheme, e.g. `http://localhost:3000`
- **Helmet** — sane defaults; CSP enabled in production.
- **Rate limits** (in-memory, V1):
  - public endpoint: 60/min/IP **and** 100/min/`public_token`
  - admin login: 5/15 min/IP
- **Trust proxy** — `TRUST_PROXY_HOPS` controls Express's trust level so
  `req.ip` reflects the real client behind Nginx/Cloudflare.
- **Body limits** — 100 KB HTTP cap, 32 KB logical cap on `form_payload`.
- **Logs never contain `form_payload` content.** Only metadata is logged.

---

## Backups

Postgres uses a named Docker volume (`public_form_logger_postgres_data`) so data
survives `docker compose down`.

Manual backup:

```bash
bash scripts/db-backup.sh             # writes to ./backups/<ts>.dump
```

Restore:

```bash
PGPASSWORD=$POSTGRES_PASSWORD pg_restore \
  -h 127.0.0.1 -p 5433 -U $POSTGRES_USER \
  -d $POSTGRES_DB -c \
  ./backups/public_form_logger-<ts>.dump
```

For production, prefer a managed Postgres (Supabase/Neon/Cloud SQL/RDS) with
automatic backups.

---

## Tests

```bash
npm run test:e2e
```

Requires a reachable Postgres + a `.env` with `JWT_SECRET` and `DATABASE_URL`.
The suite cleans the `public_form_logs` table before/after running.

---

## Environment variables

See [`.env.example`](.env.example) and [`.env.docker.example`](.env.docker.example) for the full list with comments.

| Variable | Required | Default |
|---|---|---|
| `NODE_ENV` | yes | `development` |
| `PORT` | no | `4001` |
| `DATABASE_URL` | **yes** | — |
| `JWT_SECRET` | **yes (≥ 32 chars)** | — |
| `JWT_EXPIRES_IN` | no | `8h` |
| `ADMIN_EMAIL` | yes (for seed) | — |
| `ADMIN_PASSWORD` | yes (for seed, ≥ 8 chars) | — |
| `COOKIE_SECURE` | no | `false` |
| `COOKIE_SAMESITE` | no | `lax` |
| `CORS_ORIGINS` | yes | — |
| `RATE_LIMIT_PUBLIC_PER_IP` | no | `60` |
| `RATE_LIMIT_PUBLIC_PER_TOKEN` | no | `100` |
| `RATE_LIMIT_LOGIN_MAX` | no | `5` |
| `RATE_LIMIT_LOGIN_WINDOW_MIN` | no | `15` |
| `HTTP_BODY_LIMIT_BYTES` | no | `102400` |
| `MAX_FORM_PAYLOAD_BYTES` | no | `32768` |
| `MAX_FORM_PAYLOAD_KEYS` | no | `100` |
| `TRUST_PROXY_HOPS` | no | `1` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | docker-compose only | — |
| `POSTGRES_PORT_HOST` | docker-compose only | `5433` |

---

## License

UNLICENSED — internal Rabiegha project.
