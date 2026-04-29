#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
DEFAULT_COMPOSE_FILE="${REPO_ROOT}/infra/compose/docker-compose.dev.yml"
COMPOSE_FILE="${1:-${KUUNA_COMPOSE_FILE:-${COMPOSE_FILE:-$DEFAULT_COMPOSE_FILE}}}"
ARTIFACT_DIR="${KUUNA_DR_ARTIFACT_DIR:-${SCRIPT_DIR}/artifacts}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${ARTIFACT_DIR}/kuuna-${TIMESTAMP}.sql"
RESTORE_DB="kuuna_restore_smoke_${TIMESTAMP//-/}"

log() {
  printf '[dr-smoke] %s\n' "$*"
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  log "dropping temporary database: ${RESTORE_DB}"
  compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${RESTORE_DB}\";" >/dev/null || true
}

trap cleanup EXIT

mkdir -p "$ARTIFACT_DIR"

log "using compose file: $COMPOSE_FILE"
log "artifacts directory: $ARTIFACT_DIR"

log "ensuring postgres is running"
compose up -d postgres >/dev/null

log "creating backup: $BACKUP_FILE"
compose exec -T postgres pg_dump -U postgres -d kuuna --no-owner --no-privileges > "$BACKUP_FILE"

log "creating temporary restore database: ${RESTORE_DB}"
compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${RESTORE_DB}\" TEMPLATE template0;" >/dev/null

log "restoring dump into ${RESTORE_DB}"
compose exec -T postgres psql -U postgres -d "$RESTORE_DB" -v ON_ERROR_STOP=1 < "$BACKUP_FILE" >/dev/null

log "running restore sanity checks"
TABLE_COUNT="$(compose exec -T postgres psql -U postgres -d "$RESTORE_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
if [[ -z "$TABLE_COUNT" || "$TABLE_COUNT" -lt 1 ]]; then
  echo "restore sanity check failed: no public tables found" >&2
  exit 1
fi

if ! compose exec -T postgres psql -U postgres -d "$RESTORE_DB" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='__kuuna_drizzle_migrations';" | grep -q '^1$'; then
  echo "restore sanity check failed: migration table missing" >&2
  exit 1
fi

log "backup+restore smoke passed (tables=${TABLE_COUNT})"
log "backup artifact written to: $BACKUP_FILE"
