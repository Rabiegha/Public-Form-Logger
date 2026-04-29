#!/usr/bin/env bash
# Manual pg_dump backup for V1.
# Usage:
#   bash scripts/db-backup.sh                # writes to ./backups/<timestamp>.dump
#   BACKUP_DIR=/var/backups bash scripts/...
#
# Reads PG creds from .env (or .env.docker if running on the prod host).
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC2046,SC1090
  export $(grep -v '^#' "$ENV_FILE" | xargs -I{} echo {})
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

TS="$(date -u +%Y%m%d-%H%M%SZ)"
OUT="$BACKUP_DIR/public_form_logger-$TS.dump"

PORT="${POSTGRES_PORT_HOST:-5433}"

PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h 127.0.0.1 \
  -p "$PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -F c \
  -f "$OUT"

echo "[db-backup] wrote $OUT"
