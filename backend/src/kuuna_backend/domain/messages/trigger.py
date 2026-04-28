from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Final

from kuuna_backend.api.schemas.gateway import GatewayInboundEvent

TRIGGER_PREFIXES: Final[tuple[str, ...]] = ("kuuna:", "/kuuna", "!kuuna")
DEFAULT_AGENT_MENTION_ALIASES: Final[tuple[str, ...]] = ("agent", "kuuna")


@dataclass(frozen=True, slots=True)
class TriggerDecision:
    should_execute: bool
    reason: str
    trigger_type: str | None = None


def evaluate_trigger(event: GatewayInboundEvent) -> TriggerDecision:
    if _has_agent_mention(event):
        return TriggerDecision(
            should_execute=True,
            reason="agent_mention_present",
            trigger_type="mention",
        )

    if event.message.reply_to_provider_message_id:
        return TriggerDecision(
            should_execute=True,
            reason="reply_to_provider_message_id_present",
            trigger_type="reply",
        )

    text = (event.message.text or "").lstrip()
    if any(text.startswith(prefix) for prefix in TRIGGER_PREFIXES):
        return TriggerDecision(
            should_execute=True,
            reason="prefix_match",
            trigger_type="prefix",
        )

    return TriggerDecision(
        should_execute=False,
        reason="no_trigger_match",
        trigger_type=None,
    )


def _has_agent_mention(event: GatewayInboundEvent) -> bool:
    configured_ids = _configured_csv_values("AGENT_MENTION_IDS")
    configured_aliases = {
        *DEFAULT_AGENT_MENTION_ALIASES,
        *_configured_csv_values("AGENT_MENTION_ALIASES"),
    }

    for mention in event.message.mentions:
        normalized_mention = _normalize_mention_value(mention)
        if configured_ids and normalized_mention in configured_ids:
            return True
        if normalized_mention in configured_aliases:
            return True

    text = event.message.text or ""
    return _text_has_agent_alias(text, configured_aliases)


def _configured_csv_values(env_name: str) -> set[str]:
    raw_value = os.getenv(env_name, "")
    return {
        _normalize_mention_value(value)
        for value in raw_value.split(",")
        if _normalize_mention_value(value)
    }


def _normalize_mention_value(value: str) -> str:
    return value.strip().lstrip("@").lower()


def _text_has_agent_alias(text: str, aliases: set[str]) -> bool:
    if not aliases:
        return False

    for alias in aliases:
        if not alias:
            continue
        pattern = rf"(^|\s)@{re.escape(alias)}(?=\b|[^\w])"
        if re.search(pattern, text, flags=re.IGNORECASE):
            return True
    return False
