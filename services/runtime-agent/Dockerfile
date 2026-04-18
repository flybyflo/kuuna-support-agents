FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
COPY tests ./tests

RUN uv sync

EXPOSE 8100

CMD ["uv", "run", "uvicorn", "app:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8100", "--reload"]
