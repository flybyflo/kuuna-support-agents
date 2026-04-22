from __future__ import annotations

import json
import logging
import os
import re
import threading
from typing import Any

import uvicorn

_SENSITIVE_KEY_PARTS = {
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
    """Emit one JSON object per log record with sensitive-field scrubbing."""

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
            if key not in self._SKIP and not key.startswith("_"):
                entry[key] = _scrub_value(str(key), value)

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

    sentry_dsn = os.getenv("SENTRY_DSN")
    if not sentry_dsn:
        return

    try:
        import sentry_sdk
    except Exception:  # pragma: no cover - optional runtime dependency
        logging.getLogger(__name__).warning("sentry_sdk_unavailable")
        return

    sentry_sdk.init(
        dsn=sentry_dsn,
        send_default_pii=False,
        before_send=_scrub_sentry_event,
        environment=os.getenv("SENTRY_ENVIRONMENT", "dev"),
    )
    _SENTRY_INITIALIZED = True


def main() -> None:
    _configure_logging()
    _init_sentry()

    # Import after logging is configured so bridge loggers inherit the handler.
    from connection_status import GatewayConnectionStatus  # noqa: PLC0415
    from neonize_bridge import initialize_neonize_gateway  # noqa: PLC0415
    from ops_api import create_ops_app  # noqa: PLC0415
    from qr_status import GatewayQrStatus  # noqa: PLC0415

    connection_status = GatewayConnectionStatus()
    qr_status = GatewayQrStatus()

    client, neonize_wait = initialize_neonize_gateway(
        connection_status=connection_status,
        session_name=os.getenv("GATEWAY_SESSION_NAME", "kuuna-gateway"),
        backend_base_url=os.getenv("BACKEND_BASE_URL", "http://backend:8000"),
        service_token=os.getenv("GATEWAY_SERVICE_TOKEN"),
        database_path=os.getenv("NEONIZE_DATABASE_PATH", "/data/neonize.db"),
        qr_status=qr_status,
    )

    def _connect_gateway_client() -> None:
        logging.getLogger(__name__).info(
            "gateway_starting",
            extra={"session_name": os.getenv("GATEWAY_SESSION_NAME", "kuuna-gateway")},
        )
        client.connect()

    connect_thread = threading.Thread(target=_connect_gateway_client, name="neonize-connect", daemon=True)
    connect_thread.start()

    wait_thread = threading.Thread(target=neonize_wait.wait, name="neonize-event-loop", daemon=True)
    wait_thread.start()

    app = create_ops_app(
        client=client,
        ops_token=os.getenv("GATEWAY_OPS_TOKEN"),
        service_token=os.getenv("GATEWAY_SERVICE_TOKEN"),
        connection_status_provider=connection_status.snapshot,
        qr_status_provider=qr_status.snapshot,
    )
    host = os.getenv("GATEWAY_OPS_HOST", "0.0.0.0")
    port = int(os.getenv("GATEWAY_OPS_PORT", "8090"))

    logging.getLogger(__name__).info(
        "gateway_ops_api_starting",
        extra={"host": host, "port": port},
    )

    uvicorn.run(app, host=host, port=port, log_level=os.getenv("LOG_LEVEL", "info").lower())


if __name__ == "__main__":
    main()
