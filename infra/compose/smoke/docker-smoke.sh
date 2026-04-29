#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
DEFAULT_COMPOSE_FILE="${REPO_ROOT}/infra/compose/docker-compose.dev.yml"
COMPOSE_FILE="${1:-${KUUNA_COMPOSE_FILE:-${COMPOSE_FILE:-$DEFAULT_COMPOSE_FILE}}}"

log() {
  printf '[docker-smoke] %s\n' "$*"
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 2
  fi
}

wait_for_backend_health() {
  local retries=30
  local delay=2
  for ((i=1; i<=retries; i++)); do
    if curl -fsS "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

wait_for_gateway_health() {
  local retries=20
  local delay=2
  for ((i=1; i<=retries; i++)); do
    if curl -fsS "http://127.0.0.1:8090/trpc/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

require_command docker
require_command curl

log "using compose file: $COMPOSE_FILE"

log "building lazy runtime image"
docker build -f "${REPO_ROOT}/services/runtime-agent-ts/Dockerfile" -t kuuna-runtime-agent-ts:dev "$REPO_ROOT" >/dev/null

log "ensuring required services are running"
compose up -d postgres redis minio backend worker gateway >/dev/null

log "checking postgres health"
compose exec -T postgres pg_isready -U postgres -d kuuna >/dev/null

log "checking redis health"
compose exec -T redis redis-cli ping | grep -q PONG

log "checking backend /health"
if ! wait_for_backend_health; then
  echo "backend /health did not become ready" >&2
  exit 1
fi

log "checking gateway tRPC health"
if ! wait_for_gateway_health; then
  echo "gateway tRPC health did not become ready" >&2
  exit 1
fi

log "running drizzle migrations"
compose run --build --rm migrate >/dev/null

log "verifying core tables exist"
compose exec -T postgres psql -U postgres -d kuuna -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users','messages','outbound_intents','audit_events');" | grep -q '^4$'

log "docker smoke passed"
