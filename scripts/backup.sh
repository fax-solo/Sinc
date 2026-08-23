#!/usr/bin/env bash
# M9.2 backup/restore drill. Dumps the Postgres database to a timestamped,
# gzipped SQL file under backups/.
#
# Usage:
#   scripts/backup.sh                     # uses DATABASE_URL from apps/server/.env
#   DATABASE_URL=postgresql://... ./scripts/backup.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_DIR/apps/server/.env"

if [[ -z "${DATABASE_URL:-}" && -f "$ENV_FILE" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL not set (checked env and $ENV_FILE)" >&2
  exit 1
fi

# pg_dump/psql reject URL query params like ?schema=public; strip them.
PG_URL="${DATABASE_URL%%\?*}"
BACKUP_DIR="$REPO_DIR/backups"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/sinc-$STAMP.sql.gz"

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump --no-owner --no-privileges "$PG_URL" | gzip > "$OUT"
else
  echo "error: pg_dump not found; install postgresql-client" >&2
  exit 1
fi

echo "backup written: $OUT"