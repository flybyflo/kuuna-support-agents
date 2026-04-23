ARG BASE_IMAGE=python:3.12-slim-bookworm
FROM ${BASE_IMAGE}

ARG KUUNA_TEMPLATE_KEY=unknown
ARG KUUNA_TEMPLATE_VERSION_ID=unknown

LABEL kuuna.template.key="${KUUNA_TEMPLATE_KEY}"
LABEL kuuna.template_version.id="${KUUNA_TEMPLATE_VERSION_ID}"

ENV PYTHONUNBUFFERED=1

WORKDIR /opt/kuuna

RUN python - <<'PY'
print("kuuna template-agent image scaffold")
PY
