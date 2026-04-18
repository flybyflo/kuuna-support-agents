from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from kuuna_backend.api.schemas.gateway import GatewayInboundEvent

TRIGGER_PREFIXES: Final[tuple[str, ...]] = ("kuuna:", "/kuuna", "!kuuna")


@dataclass(frozen=True, slots=True)
class TriggerDecision:
    should_execute: bool
    reason: str
    trigger_type: str | None = None


def evaluate_trigger(event: GatewayInboundEvent) -> TriggerDecision:
    if event.message.mentions:
        return TriggerDecision(
            should_execute=True,
            reason="mention_present",
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
