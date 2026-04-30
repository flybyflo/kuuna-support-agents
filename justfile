set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

compose_file := "infra/compose/docker-compose.dev.yml"
prod_compose_file := "infra/compose/docker-compose.prod.yml"

default:
    @just --list

runtime-image:
    docker build -f services/runtime-agent-ts/Dockerfile -t kuuna-runtime-agent-ts:dev .

up:
    just runtime-image
    docker compose -f {{compose_file}} up --build

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
    docker build -f services/runtime-agent-ts/Dockerfile -t kuuna-runtime-agent-ts:prod .
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
