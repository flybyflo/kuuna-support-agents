set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

compose_file := "infra/compose/docker-compose.dev.yml"
compose := "docker compose -f {{compose_file}}"

default:
    @just --list

up:
    {{compose}} up --build

down:
    {{compose}} down

restart service:
    {{compose}} restart {{service}}

logs:
    {{compose}} logs -f

logs-service service:
    {{compose}} logs -f {{service}}

ps:
    {{compose}} ps

migrate:
    {{compose}} exec backend uv run alembic upgrade head

shell-backend:
    {{compose}} exec backend sh

shell-worker:
    {{compose}} exec worker sh

shell-gateway:
    {{compose}} exec gateway sh

shell-dashboard:
    {{compose}} exec dashboard sh

reset-whatsapp-session:
    docker volume rm kuuna-dev_gateway_session
