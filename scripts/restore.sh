#!/usr/bin/env bash
# M9.2 restore drill. Restores a backup produced by scripts/backup.sh into the
# database. Drops existing schema first — only run against a disposable database.
#
# Usage:
#   scripts/restore.sh backups/sinc-<timestamp>.sql.gz
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_DIR/apps/server/.env"

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <backup-file.sql.gz>" >&2
  exit 1
fi

INPUT="$1"
if [[ ! -f "$INPUT" ]]; then
  echo "error: backup file not found: $INPUT" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -f "$ENV_FILE" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL not set (checked env and $ENV_FILE)" >&2
  exit 1
fi

# psql rejects URL query params like ?schema=public; strip them.
PG_URL="${DATABASE_URL%%\?*}"

echo "restoring $INPUT into $PG_URL (destructive)..." >&2
gunzip -c "$INPUT" | psql "$PG_URL"
echo "restore complete" >&2