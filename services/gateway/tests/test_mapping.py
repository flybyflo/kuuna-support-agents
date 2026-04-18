from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from mapping import map_neonize_message_event  # noqa: E402


@dataclass
class FakeJID:
    User: str
    Server: str


@dataclass
class FakeSource:
    Chat: FakeJID
    Sender: FakeJID


@dataclass
class FakeContext:
    stanzaID: str
    mentionedJID: list[str]


@dataclass
class FakeExtendedTextMessage:
    text: str
    contextInfo: FakeContext


@dataclass
class FakeMessage:
    conversation: str | None
    extendedTextMessage: FakeExtendedTextMessage


@dataclass
class FakeInfo:
    ID: str
    MessageSource: FakeSource
    Timestamp: datetime


@dataclass
class FakeEvent:
    Info: FakeInfo
    Message: FakeMessage


def test_map_neonize_message_event_includes_raw_payload() -> None:
    event = FakeEvent(
        Info=FakeInfo(
            ID="msg-1",
            MessageSource=FakeSource(
                Chat=FakeJID(User="1203630-group", Server="g.us"),
                Sender=FakeJID(User="4912345", Server="s.whatsapp.net"),
            ),
            Timestamp=datetime(2026, 4, 18, tzinfo=UTC),
        ),
        Message=FakeMessage(
            conversation="hello",
            extendedTextMessage=FakeExtendedTextMessage(
                text="hello",
                contextInfo=FakeContext(stanzaID="msg-0", mentionedJID=["4911@s.whatsapp.net"]),
            ),
        ),
    )

    mapped = map_neonize_message_event(event)

    assert mapped["provider"] == "whatsapp-neonize"
    assert mapped["provider_group_id"] == "1203630-group@g.us"
    assert mapped["provider_message_id"] == "msg-1"
    assert mapped["message"]["text"] == "hello"
    assert mapped["raw_event"]["Info"]["ID"] == "msg-1"
