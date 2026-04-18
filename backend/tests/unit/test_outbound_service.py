from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from kuuna_backend.db.models import OutboundIntent, OutboundStatus
from kuuna_backend.domain.outbound.service import (
    create_outbound_intent,
    get_outbound_intent,
    mark_outbound_intent_failed,
    mark_outbound_intent_retrying,
    mark_outbound_intent_sending,
    mark_outbound_intent_sent,
)


@pytest.fixture()
def db() -> Session:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    OutboundIntent.__table__.create(bind=engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, class_=Session)
    session = factory()
    try:
        yield session
    finally:
        session.close()


def test_create_outbound_intent_creates_with_pending_status(db: Session) -> None:
    intent_id = uuid4()
    intent = create_outbound_intent(
        db,
        outbound_intent_id=intent_id,
        provider_group_id="group-1@g.us",
        payload={"kind": "reply", "text": "hello"},
    )
    assert intent.status == OutboundStatus.PENDING
    assert intent.outbound_intent_id == intent_id
    assert intent.attempt_count == 0
    assert intent.payload["_dispatch"]["last_status"] == "pending"


def test_create_outbound_intent_generates_id_if_not_provided(db: Session) -> None:
    intent = create_outbound_intent(
        db,
        provider_group_id="group-1@g.us",
        payload={"kind": "reply"},
    )
    assert intent.outbound_intent_id is not None


def test_create_outbound_intent_sets_provider_group_id(db: Session) -> None:
    intent = create_outbound_intent(
        db,
        provider_group_id="group-abc@g.us",
        payload={},
    )
    assert intent.provider_group_id == "group-abc@g.us"


def test_get_outbound_intent_returns_stored_intent(db: Session) -> None:
    intent_id = uuid4()
    create_outbound_intent(db, outbound_intent_id=intent_id, provider_group_id="g@g.us", payload={})
    result = get_outbound_intent(db, intent_id)
    assert result is not None
    assert result.outbound_intent_id == intent_id


def test_get_outbound_intent_returns_none_for_unknown_id(db: Session) -> None:
    result = get_outbound_intent(db, uuid4())
    assert result is None


def test_mark_outbound_intent_sending_increments_attempt_count(db: Session) -> None:
    intent_id = uuid4()
    create_outbound_intent(db, outbound_intent_id=intent_id, provider_group_id="g@g.us", payload={})

    updated = mark_outbound_intent_sending(db, intent_id)

    assert updated is not None
    assert updated.status == OutboundStatus.SENDING
    assert updated.attempt_count == 1


def test_mark_outbound_intent_sending_twice_increments_to_two(db: Session) -> None:
    intent_id = uuid4()
    create_outbound_intent(db, outbound_intent_id=intent_id, provider_group_id="g@g.us", payload={})

    mark_outbound_intent_sending(db, intent_id)
    updated = mark_outbound_intent_sending(db, intent_id)

    assert updated.attempt_count == 2


def test_mark_outbound_intent_sending_returns_none_for_unknown_id(db: Session) -> None:
    result = mark_outbound_intent_sending(db, uuid4())
    assert result is None


def test_mark_outbound_intent_sent_updates_status_and_metadata(db: Session) -> None:
    intent_id = uuid4()
    create_outbound_intent(db, outbound_intent_id=intent_id, provider_group_id="g@g.us", payload={})

    updated = mark_outbound_intent_sent(db, intent_id, provider_message_id="provider-msg-123")

    assert updated is not None
    assert updated.status == OutboundStatus.SENT
    assert updated.payload["_dispatch"]["last_status"] == "sent"
    assert updated.payload["_dispatch"]["provider_message_id"] == "provider-msg-123"
    assert updated.payload["_dispatch"]["last_error_code"] is None
    assert updated.payload["_dispatch"]["last_error_message"] is None


def test_mark_outbound_intent_sent_without_provider_msg_id(db: Session) -> None:
    intent_id = uuid4()
    create_outbound_intent(db, outbound_intent_id=intent_id, provider_group_id="g@g.us", payload={})

    updated = mark_outbound_intent_sent(db, intent_id)

    assert updated.status == OutboundStatus.SENT
    assert updated.payload["_dispatch"]["provider_message_id"] is None


def test_mark_outbound_intent_sent_returns_none_for_unknown_id(db: Session) -> None:
    result = mark_outbound_intent_sent(db, uuid4())
    assert result is None


def test_mark_outbound_intent_failed_updates_status_and_error(db: Session) -> None:
    intent_id = uuid4()
    create_outbound_intent(db, outbound_intent_id=intent_id, provider_group_id="g@g.us", payload={})

    updated = mark_outbound_intent_failed(
        db, intent_id, error_code="E_TIMEOUT", error_message="gateway timeout"
    )

    assert updated is not None
    assert updated.status == OutboundStatus.FAILED
    assert updated.payload["_dispatch"]["last_status"] == "failed"
    assert updated.payload["_dispatch"]["last_error_code"] == "E_TIMEOUT"
    assert updated.payload["_dispatch"]["last_error_message"] == "gateway timeout"


def test_mark_outbound_intent_failed_returns_none_for_unknown_id(db: Session) -> None:
    result = mark_outbound_intent_failed(db, uuid4())
    assert result is None


def test_mark_outbound_intent_retrying_keeps_sending_status(db: Session) -> None:
    intent_id = uuid4()
    create_outbound_intent(db, outbound_intent_id=intent_id, provider_group_id="g@g.us", payload={})

    updated = mark_outbound_intent_retrying(
        db, intent_id, error_code="E_RATE_LIMIT", error_message="rate limited"
    )

    assert updated is not None
    # retrying is not a terminal state — status stays SENDING
    assert updated.status == OutboundStatus.SENDING
    assert updated.payload["_dispatch"]["last_status"] == "retrying"
    assert updated.payload["_dispatch"]["last_error_code"] == "E_RATE_LIMIT"
    assert updated.payload["_dispatch"]["last_error_message"] == "rate limited"


def test_mark_outbound_intent_retrying_returns_none_for_unknown_id(db: Session) -> None:
    result = mark_outbound_intent_retrying(db, uuid4())
    assert result is None
