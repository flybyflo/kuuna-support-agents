from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Lock
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(slots=True)
class GatewayConnectionStatus:
    connected: bool = False
    last_event: str = "startup"
    last_changed_at: str = field(default_factory=_utc_now_iso)
    last_error: str | None = None

    _lock: Lock = field(default_factory=Lock, init=False, repr=False)

    def mark_connected(self, *, event: str, error: str | None = None) -> None:
        with self._lock:
            self.connected = True
            self.last_event = event
            self.last_changed_at = _utc_now_iso()
            self.last_error = error

    def mark_disconnected(self, *, event: str, error: str | None = None) -> None:
        with self._lock:
            self.connected = False
            self.last_event = event
            self.last_changed_at = _utc_now_iso()
            self.last_error = error

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "connected": self.connected,
                "last_event": self.last_event,
                "last_changed_at": self.last_changed_at,
                "last_error": self.last_error,
                "checked_at": _utc_now_iso(),
            }
