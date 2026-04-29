# ADR-002 — Soft validation of `public_token`

**Status**: Accepted
**Date**: 2026-04-29

## Context

Attendee currently issues `public_token` values as 16-character strings drawn
from `[A-Za-z0-9]` (see `attendee-ems-back/src/common/utils/token.util.ts`).

Two options for validation in the Logger:

1. **Strict**: enforce the exact Attendee pattern (`/^[A-Za-z0-9]{16}$/`).
2. **Soft**: enforce a permissive pattern (`/^[A-Za-z0-9_-]{8,128}$/`).

## Decision

Adopt the **soft** validation pattern at the DTO layer, but emit a structured
**warning log** when an incoming token does not match Attendee's current strict
pattern. The token is still persisted.

## Rationale

- The Logger is a **safety net**. Rejecting submissions because the token shape
  changed in Attendee would defeat the purpose.
- Loose validation still blocks obvious abuse (empty strings, control chars,
  injection-shaped payloads, megabyte-long values).
- The warning log gives us monitoring without coupling: if Attendee changes its
  format, we will see a flood of `public_token.format_mismatch` events and can
  react.

## Consequences

- Logger does **not** import or depend on any Attendee constants.
- A future Attendee evolution requires zero code changes here.
- Operators must monitor the `public_token.format_mismatch` warning — investigate
  if rates spike unexpectedly.
- Token values are never logged in full (only length + 4-char prefix).
