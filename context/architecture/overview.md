# Public Form Logger — Architecture Overview

## Role

The Public Form Logger is an **independent backup service** for public landing-page
form submissions destined for the Attendee platform. It exists to guarantee that
**no form submission is ever lost**, even if Attendee is down, slow, or rejects
the request for any reason.

The Logger is intentionally **not coupled** to Attendee:

- separate codebase
- separate database (its own PostgreSQL)
- separate deployment
- separate authentication (local admin only)

## High-level flow

```
┌──────────────────┐
│   Landing Page   │
│ (choyou.fr, …)   │
└────────┬─────────┘
         │ on submit, fires TWO requests in parallel:
         │
         │   1. POST /public-form-logs        → Public Form Logger
         │      (best-effort, may retry 1–3x with backoff)
         │
         │   2. POST /public/<token>/register → Attendee API
         │      (the authoritative inscription)
         │
         ▼
┌──────────────────┐         ┌──────────────────┐
│ Public Form      │         │   Attendee API   │
│ Logger           │         │   (PostgreSQL)   │
│ (PostgreSQL)     │         └──────────────────┘
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Admin UI (EJS)  │  → list / detail / stats
│  /admin          │
└──────────────────┘
```

## Components

| Component | Responsibility |
|---|---|
| **Public ingestion** (`POST /v1/public-form-logs`) | Validate, dedup on `submission_id`, persist raw payload. Fast (<200 ms). |
| **Health** (`/health`, `/health/ready`) | Liveness + readiness (DB ping). |
| **Admin auth** (`POST /admin/auth/login`) | Bcrypt + JWT cookie httpOnly. |
| **Admin API** (`/admin/public-form-logs`, `/admin/stats`) | List, detail, basic stats. |
| **Admin UI** (EJS) | Server-rendered pages: login / dashboard / detail. |

## Non-goals (V1)

- No analytics or aggregation beyond simple counters.
- No alerting, no email, no integrations.
- No multi-tenant: a single admin user.
- No GDPR retention job in V1 (tracked as future improvement).
- No Redis: rate limit is in-memory, single-instance deploy.
