from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from fastapi import FastAPI

from kuuna_backend.api.routers import (
    agent_state,
    audit,
    auth,
    bindings,
    gateway,
    internal,
    knowledge,
    messages,
    templates,
    tools,
    users,
)
from kuuna_backend.config.settings import get_settings

_SENSITIVE_KEY_PARTS = {
    "password",
    "authorization",
    "token",
    "secret",
    "api_key",
    "raw_event",
    "download_url",
    "inline_data_base64",
    "text_content",
}
_OPENAI_KEY_PATTERN = re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")


class _StructuredFormatter(logging.Formatter):
    _SKIP: frozenset[str] = frozenset(
        {
            "args",
            "created",
            "exc_info",
            "exc_text",
            "filename",
            "funcName",
            "levelname",
            "levelno",
            "lineno",
            "message",
            "module",
            "msecs",
            "msg",
            "name",
            "pathname",
            "process",
            "processName",
            "relativeCreated",
            "stack_info",
            "taskName",
            "thread",
            "threadName",
        }
    )

    def format(self, record: logging.LogRecord) -> str:
        record.message = record.getMessage()
        entry: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": _scrub_string(record.message),
        }

        for key, value in record.__dict__.items():
            if key in self._SKIP or key.startswith("_"):
                continue
            entry[key] = _scrub_value(key, value)

        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        elif record.exc_text:
            entry["exc"] = record.exc_text

        if record.stack_info:
            entry["stack"] = self.formatStack(record.stack_info)

        return json.dumps(entry, default=str)


def _contains_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(part in lowered for part in _SENSITIVE_KEY_PARTS)


def _scrub_string(value: str) -> str:
    return _OPENAI_KEY_PATTERN.sub("[REDACTED]", value)


def _scrub_value(key: str, value: Any) -> Any:
    if _contains_sensitive_key(key):
        return "[REDACTED]"

    if isinstance(value, dict):
        return {str(k): _scrub_value(str(k), v) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub_value(key, item) for item in value]
    if isinstance(value, tuple):
        return [_scrub_value(key, item) for item in value]
    if isinstance(value, str):
        return _scrub_string(value)
    return value


def _scrub_sentry_event(event: dict[str, Any]) -> dict[str, Any]:
    return _scrub_value("event", event)


def _configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_StructuredFormatter())

    root = logging.getLogger()
    root.setLevel(os.getenv("LOG_LEVEL", "INFO"))
    root.handlers.clear()
    root.addHandler(handler)


_SENTRY_INITIALIZED = False


def _init_sentry() -> None:
    global _SENTRY_INITIALIZED  # noqa: PLW0603
    if _SENTRY_INITIALIZED:
        return

    settings = get_settings()
    if not settings.sentry_dsn:
        return

    try:
        import sentry_sdk
    except Exception:  # pragma: no cover - sentry import failure should not block boot
        logging.getLogger(__name__).warning("sentry_sdk_unavailable")
        return

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        send_default_pii=False,
        before_send=_scrub_sentry_event,
        environment=os.getenv("SENTRY_ENVIRONMENT", settings.app_env),
    )
    _SENTRY_INITIALIZED = True


def create_app() -> FastAPI:
    _configure_logging()
    _init_sentry()

    app = FastAPI(title="Kuuna Backend", version="0.1.0")

    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(templates.router)
    app.include_router(tools.router)
    app.include_router(bindings.router)
    app.include_router(messages.router)
    app.include_router(agent_state.router)
    app.include_router(knowledge.router)
    app.include_router(audit.router)
    app.include_router(gateway.router)
    app.include_router(internal.router)

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()


def run() -> None:
    import os
    import socket

    import uvicorn

    host = os.getenv("HOST") or socket.gethostbyname(socket.gethostname())
    uvicorn.run("kuuna_backend.main:app", host=host, port=8000, reload=True)


if __name__ == "__main__":
    run()
