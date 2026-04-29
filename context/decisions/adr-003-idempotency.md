# ADR-003 — Idempotency strategy

**Status**: Accepted
**Date**: 2026-04-29

## Context

Landing pages may retry the POST when network errors occur. The Logger must not
turn legitimate retries into errors visible to the frontend.

## Decision

- `submission_id` (when provided by the frontend) is **unique** at the database
  level.
- A second POST with the same `submission_id` returns **HTTP 200** with body
  `{ status: "duplicate", id: "<existing id>" }`. **Never 409.**
- A first POST returns **HTTP 201** with `{ status: "created", id: "<new id>" }`.
- Duplicate detection **never mutates** the existing record.
- When `submission_id` is **absent**, the server generates a UUID. No dedup is
  performed: legacy landing pages may produce duplicates, which is acceptable.

## Rationale

- Returning 409 would force every frontend to special-case retries. Treating
  duplicates as a non-error keeps the contract simple and forgiving.
- Generating a deterministic dedup hash from payload+token+timestamp was
  considered and **rejected**: collisions could merge two genuine submissions.

## Consequences

- The frontend retry policy (1–3 retries with exponential backoff) is safe.
- DB enforces idempotency via a unique index on `submission_id`.
- New landing pages **should** send a stable `submission_id` (UUIDv4 generated
  client-side) on every form submit.
