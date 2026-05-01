set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

compose_file := "infra/compose/docker-compose.dev.yml"
prod_compose_file := "infra/compose/docker-compose.prod.yml"

default:
    @just --list

up:
    #!/usr/bin/env bash
    set -euo pipefail

    compose_file="{{compose_file}}"
    compose_pid=""
    worker_pid=""

    cleanup() {
        if [[ -n "${worker_pid}" ]]; then
            kill "${worker_pid}" 2>/dev/null || true
        fi
        if [[ -n "${compose_pid}" ]]; then
            kill "${compose_pid}" 2>/dev/null || true
        fi
        wait "${worker_pid}" 2>/dev/null || true
        wait "${compose_pid}" 2>/dev/null || true
    }
    trap cleanup INT TERM EXIT

    load_env_file() {
        local file="$1"
        [[ -f "${file}" ]] || return 0
        while IFS= read -r line || [[ -n "${line}" ]]; do
            [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
            export "${line}"
        done < "${file}"
    }

    docker compose -f "${compose_file}" up --build --remove-orphans \
        node-deps postgres redis minio migrate backend dashboard gateway &
    compose_pid=$!

    until curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; do
        if ! kill -0 "${compose_pid}" 2>/dev/null; then
            wait "${compose_pid}"
            exit $?
        fi
        sleep 1
    done

    load_env_file infra/env/backend.env.example
    load_env_file infra/env/backend.env.local
    export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/kuuna
    export REDIS_URL=redis://127.0.0.1:6379/0
    export GATEWAY_BASE_URL=http://127.0.0.1:8090
    export S3_ENDPOINT_URL=http://127.0.0.1:9000
    export TEMPLATE_BUILD_CONTEXT_PATH="${PWD}"
    export RUNTIME_GONDOLIN_DATA_ROOT="${PWD}/.kuuna/gondolin/runtime-data"
    export RUNTIME_GONDOLIN_BUILD_ROOT="${PWD}/.kuuna/gondolin/template-builds"
    export RUNTIME_TOOL_BACKEND_BASE_URL=http://127.0.0.1:8000

    pnpm --filter @kuuna/backend-ts dev:worker &
    worker_pid=$!

    while true; do
        if ! kill -0 "${compose_pid}" 2>/dev/null; then
            wait "${compose_pid}"
            exit $?
        fi
        if ! kill -0 "${worker_pid}" 2>/dev/null; then
            wait "${worker_pid}"
            exit $?
        fi
        sleep 1
    done

down:
    docker compose -f {{compose_file}} down

restart service:
    docker compose -f {{compose_file}} restart {{service}}

logs:
    docker compose -f {{compose_file}} logs -f

logs-service service:
    docker compose -f {{compose_file}} logs -f {{service}}

ps:
    docker compose -f {{compose_file}} ps

migrate:
    docker compose -f {{compose_file}} run --build --rm migrate

shell-backend:
    docker compose -f {{compose_file}} exec backend sh

shell-worker:
    docker compose -f {{compose_file}} exec worker sh

shell-gateway:
    docker compose -f {{compose_file}} exec gateway sh

shell-dashboard:
    docker compose -f {{compose_file}} exec dashboard sh

reset-whatsapp-session:
    docker volume rm kuuna-dev_gateway_session

smoke-docker:
    bash infra/compose/smoke/docker-smoke.sh

smoke-dr-restore:
    bash infra/compose/smoke/dr-backup-restore.sh

smoke-all:
    just smoke-docker
    just smoke-dr-restore

prod-build:
    docker compose -f {{prod_compose_file}} build

prod-up:
    just prod-build
    docker compose -f {{prod_compose_file}} up

prod-down:
    docker compose -f {{prod_compose_file}} down

prod-logs:
    docker compose -f {{prod_compose_file}} logs -f

prod-migrate:
    docker compose -f {{prod_compose_file}} run --build --rm migrate
