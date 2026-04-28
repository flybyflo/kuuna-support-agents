from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from kuuna_backend.api.schemas.gateway import GatewayInboundEvent, InboundMessage
from kuuna_backend.domain.messages.trigger import TRIGGER_PREFIXES, evaluate_trigger


def _make_event(
    *,
    text: str | None = None,
    mentions: list[str] | None = None,
    reply_to: str | None = None,
    event_type: str = "message_created",
) -> GatewayInboundEvent:
    return GatewayInboundEvent(
        trace_id=uuid4(),
        provider="whatsapp-neonize",
        provider_group_id="group-test@g.us",
        provider_message_id=str(uuid4()),
        event_type=event_type,
        occurred_at=datetime.now(timezone.utc),
        message=InboundMessage(
            text=text,
            mentions=mentions or [],
            reply_to_provider_message_id=reply_to,
        ),
    )


def test_evaluate_trigger_configured_mention_present(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MENTION_IDS", "bot@s.whatsapp.net")
    event = _make_event(mentions=["bot@s.whatsapp.net"])
    decision = evaluate_trigger(event)
    assert decision.should_execute is True
    assert decision.trigger_type == "mention"
    assert decision.reason == "agent_mention_present"


def test_evaluate_trigger_ignores_unconfigured_mention(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MENTION_IDS", "bot@s.whatsapp.net")
    event = _make_event(mentions=["lawyer@s.whatsapp.net"])
    decision = evaluate_trigger(event)
    assert decision.should_execute is False
    assert decision.trigger_type is None
    assert decision.reason == "no_trigger_match"


def test_evaluate_trigger_text_agent_alias_present(monkeypatch) -> None:
    monkeypatch.delenv("AGENT_MENTION_IDS", raising=False)
    monkeypatch.delenv("AGENT_MENTION_ALIASES", raising=False)
    event = _make_event(text="@agent can you answer this?")
    decision = evaluate_trigger(event)
    assert decision.should_execute is True
    assert decision.trigger_type == "mention"


def test_evaluate_trigger_reply_present() -> None:
    event = _make_event(reply_to="msg-prev-1")
    decision = evaluate_trigger(event)
    assert decision.should_execute is True
    assert decision.trigger_type == "reply"
    assert decision.reason == "reply_to_provider_message_id_present"


def test_evaluate_trigger_prefix_kuuna_colon() -> None:
    event = _make_event(text="kuuna: help me")
    decision = evaluate_trigger(event)
    assert decision.should_execute is True
    assert decision.trigger_type == "prefix"
    assert decision.reason == "prefix_match"


def test_evaluate_trigger_prefix_slash_kuuna() -> None:
    event = _make_event(text="/kuuna translate this")
    decision = evaluate_trigger(event)
    assert decision.should_execute is True
    assert decision.trigger_type == "prefix"
    assert decision.reason == "prefix_match"


def test_evaluate_trigger_prefix_bang_kuuna() -> None:
    event = _make_event(text="!kuuna summarize")
    decision = evaluate_trigger(event)
    assert decision.should_execute is True
    assert decision.trigger_type == "prefix"
    assert decision.reason == "prefix_match"


def test_evaluate_trigger_prefix_with_leading_whitespace() -> None:
    # lstrip() is applied before prefix check
    event = _make_event(text="   kuuna: with leading spaces")
    decision = evaluate_trigger(event)
    assert decision.should_execute is True
    assert decision.trigger_type == "prefix"


def test_evaluate_trigger_no_match_plain_text() -> None:
    event = _make_event(text="just a plain message")
    decision = evaluate_trigger(event)
    assert decision.should_execute is False
    assert decision.trigger_type is None
    assert decision.reason == "no_trigger_match"


def test_evaluate_trigger_none_text_no_match() -> None:
    event = _make_event(text=None)
    decision = evaluate_trigger(event)
    assert decision.should_execute is False
    assert decision.trigger_type is None


def test_evaluate_trigger_empty_text_no_match() -> None:
    event = _make_event(text="")
    decision = evaluate_trigger(event)
    assert decision.should_execute is False
    assert decision.trigger_type is None


def test_evaluate_trigger_mention_takes_priority_over_reply() -> None:
    """Mention check precedes reply check in the evaluation order."""
    event = _make_event(text="@agent please check", reply_to="msg-prev-1")
    decision = evaluate_trigger(event)
    assert decision.trigger_type == "mention"


def test_evaluate_trigger_reply_takes_priority_over_prefix() -> None:
    """Reply check precedes prefix check in the evaluation order."""
    event = _make_event(reply_to="msg-prev-1", text="kuuna: also a prefix")
    decision = evaluate_trigger(event)
    assert decision.trigger_type == "reply"


def test_trigger_prefixes_constant_contains_all_expected_values() -> None:
    assert "kuuna:" in TRIGGER_PREFIXES
    assert "/kuuna" in TRIGGER_PREFIXES
    assert "!kuuna" in TRIGGER_PREFIXES
