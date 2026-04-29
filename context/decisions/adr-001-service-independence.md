# ADR-001 — Service independence from Attendee

**Status**: Accepted
**Date**: 2026-04-29

## Context

The Public Form Logger captures landing-page submissions that are also sent to
Attendee. Two design alternatives were considered:

1. **Embed** the logger as a module inside the Attendee API.
2. **Build a standalone service** with its own DB and deploy.

## Decision

We build the Logger as a **fully independent service**:

- own NestJS codebase, own repository
- own PostgreSQL database
- own deployment lifecycle
- own admin authentication (no SSO with Attendee in V1)

## Rationale

- **Resilience**: if Attendee is down or buggy, the Logger must still capture
  data. Sharing infra defeats the purpose.
- **Blast radius**: a deploy or migration on Attendee cannot break the Logger.
- **Simplicity of audit**: the Logger holds raw, immutable copies — keeping it
  separate avoids any temptation to mutate or join with Attendee data.
- **Iteration speed**: small surface, can be patched without scheduling around
  Attendee releases.

## Consequences

- Two databases to back up and monitor.
- No cross-DB joins (intentional).
- Admin user lives in the Logger DB, not Attendee.
- Future SSO with Attendee is possible but explicitly out of scope for V1.
