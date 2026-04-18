from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4
import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from outbound_handler import VALID_DELIVERY_STATUSES, BackendOutboundDispatcher  # noqa: E402


def _make_dispatcher() -> BackendOutboundDispatcher:
    return BackendOutboundDispatcher(
        backend_base_url="http://backend:8000",
        provider_base_url="http://provider:3000",
    )


def test_build_status_payload_sent() -> None:
    dispatcher = _make_dispatcher()
    intent_id = uuid4()
    trace_id = uuid4()
    payload = {"trace_id": trace_id, "outbound_intent_id": intent_id}

    result = dispatcher.build_status_payload(
        payload,
        status="sent",
        provider_message_id="msg-1",
    )

    assert result["status"] == "sent"
    assert result["provider_message_id"] == "msg-1"
    assert result["trace_id"] == str(trace_id)
    assert result["outbound_intent_id"] == str(intent_id)
    assert result["error_code"] is None
    assert result["error_message"] is None
    assert "occurred_at" in result


def test_build_status_payload_failed() -> None:
    dispatcher = _make_dispatcher()
    payload = {"trace_id": uuid4(), "outbound_intent_id": uuid4()}

    result = dispatcher.build_status_payload(
        payload,
        status="failed",
        error_code="E_TIMEOUT",
        error_message="gateway timed out",
    )

    assert result["status"] == "failed"
    assert result["error_code"] == "E_TIMEOUT"
    assert result["error_message"] == "gateway timed out"
    assert result["provider_message_id"] is None


def test_build_status_payload_retrying() -> None:
    dispatcher = _make_dispatcher()
    payload = {"trace_id": uuid4(), "outbound_intent_id": uuid4()}

    result = dispatcher.build_status_payload(
        payload,
        status="retrying",
        error_code="E_RATE_LIMIT",
        error_message="rate limited by provider",
    )

    assert result["status"] == "retrying"
    assert result["error_code"] == "E_RATE_LIMIT"


def test_build_status_payload_invalid_status_raises_value_error() -> None:
    dispatcher = _make_dispatcher()
    payload = {"trace_id": uuid4(), "outbound_intent_id": uuid4()}

    try:
        dispatcher.build_status_payload(payload, status="unknown_status")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "unsupported" in str(exc)


def test_build_status_payload_missing_trace_id_raises_value_error() -> None:
    dispatcher = _make_dispatcher()
    payload = {"outbound_intent_id": uuid4()}  # missing trace_id

    try:
        dispatcher.build_status_payload(payload, status="sent")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "trace_id" in str(exc)


def test_build_status_payload_missing_outbound_intent_id_raises_value_error() -> None:
    dispatcher = _make_dispatcher()
    payload = {"trace_id": uuid4()}  # missing outbound_intent_id

    try:
        dispatcher.build_status_payload(payload, status="sent")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "outbound_intent_id" in str(exc)


def test_build_status_payload_uses_provided_occurred_at() -> None:
    dispatcher = _make_dispatcher()
    occurred_at = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
    payload = {"trace_id": uuid4(), "outbound_intent_id": uuid4()}

    result = dispatcher.build_status_payload(payload, status="retrying", occurred_at=occurred_at)

    assert "2026-04-18" in result["occurred_at"]


def test_build_status_payload_uses_default_occurred_at_when_none() -> None:
    dispatcher = _make_dispatcher()
    payload = {"trace_id": uuid4(), "outbound_intent_id": uuid4()}

    result = dispatcher.build_status_payload(payload, status="sent")

    # occurred_at should be an ISO 8601 string
    assert isinstance(result["occurred_at"], str)
    assert "T" in result["occurred_at"]


def test_build_status_payload_serializes_uuid_to_string() -> None:
    dispatcher = _make_dispatcher()
    intent_id = uuid4()
    trace_id = uuid4()
    payload = {"trace_id": trace_id, "outbound_intent_id": intent_id}

    result = dispatcher.build_status_payload(payload, status="sent")

    assert isinstance(result["trace_id"], str)
    assert isinstance(result["outbound_intent_id"], str)


def test_valid_delivery_statuses_contains_expected_values() -> None:
    assert "sent" in VALID_DELIVERY_STATUSES
    assert "failed" in VALID_DELIVERY_STATUSES
    assert "retrying" in VALID_DELIVERY_STATUSES


def test_valid_delivery_statuses_excludes_pending_and_sending() -> None:
    assert "pending" not in VALID_DELIVERY_STATUSES
    assert "sending" not in VALID_DELIVERY_STATUSES
