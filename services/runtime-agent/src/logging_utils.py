from __future__ import annotations

import json
import logging
import os
from typing import Any


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
            "message": record.message,
        }

        for key, value in record.__dict__.items():
            if key not in self._SKIP and not key.startswith("_"):
                entry[key] = value

        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)

        return json.dumps(entry, default=str)


_CONFIGURED = False


def configure_json_logging() -> None:
    global _CONFIGURED  # noqa: PLW0603
    if _CONFIGURED:
        return

    handler = logging.StreamHandler()
    handler.setFormatter(_StructuredFormatter())

    root = logging.getLogger()
    root.setLevel(os.getenv("LOG_LEVEL", "INFO"))
    root.handlers.clear()
    root.addHandler(handler)

    _CONFIGURED = True
