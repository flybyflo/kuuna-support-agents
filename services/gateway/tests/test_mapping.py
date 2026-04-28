from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
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
    Message: Any


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
    assert mapped["event_type"] == "message_created"
    assert mapped["message"]["text"] == "hello"
    assert mapped["raw_event"]["Info"]["ID"] == "msg-1"


def test_map_neonize_message_event_extracts_media_with_uppercase_keys() -> None:
    event = FakeEvent(
        Info=FakeInfo(
            ID="msg-media-1",
            MessageSource=FakeSource(
                Chat=FakeJID(User="1203630-group", Server="g.us"),
                Sender=FakeJID(User="4912345", Server="s.whatsapp.net"),
            ),
            Timestamp=datetime(2026, 4, 18, tzinfo=UTC),
        ),
        Message={
            "conversation": None,
            "imageMessage": {
                "URL": "https://example.com/image.jpg",
                "Mimetype": "image/jpeg",
                "fileLength": "1234",
                "mediaKey": "media-key-1",
            },
        },
    )

    mapped = map_neonize_message_event(event)

    assert len(mapped["message"]["media"]) == 1
    media = mapped["message"]["media"][0]
    assert media["download_url"] == "https://example.com/image.jpg"
    assert media["mime_type"] == "image/jpeg"
    assert media["byte_size"] == 1234
    assert media["provider_media_id"] == "media-key-1"


def test_map_neonize_message_event_extracts_caption_as_text() -> None:
    event = FakeEvent(
        Info=FakeInfo(
            ID="msg-caption-1",
            MessageSource=FakeSource(
                Chat=FakeJID(User="1203630-group", Server="g.us"),
                Sender=FakeJID(User="4912345", Server="s.whatsapp.net"),
            ),
            Timestamp=datetime(2026, 4, 18, tzinfo=UTC),
        ),
        Message={
            "image_message": {
                "url": "https://example.com/image.jpg",
                "mimetype": "image/jpeg",
                "mediaKey": "media-key-caption",
                "caption": "photo caption",
            },
        },
    )

    mapped = map_neonize_message_event(event)

    assert mapped["message"]["text"] == "photo caption"
    assert mapped["message"]["media"][0]["provider_media_id"] == "media-key-caption"


def test_map_neonize_message_event_unwraps_ephemeral_message() -> None:
    event = FakeEvent(
        Info=FakeInfo(
            ID="msg-ephemeral-1",
            MessageSource=FakeSource(
                Chat=FakeJID(User="1203630-group", Server="g.us"),
                Sender=FakeJID(User="4912345", Server="s.whatsapp.net"),
            ),
            Timestamp=datetime(2026, 4, 18, tzinfo=UTC),
        ),
        Message={
            "ephemeralMessage": {
                "message": {
                    "extendedTextMessage": {
                        "text": "wrapped hello",
                        "contextInfo": {
                            "stanzaID": "msg-0",
                            "mentionedJID": ["4911@s.whatsapp.net"],
                        },
                    },
                },
            },
        },
    )

    mapped = map_neonize_message_event(event)

    assert mapped["message"]["text"] == "wrapped hello"
    assert mapped["message"]["reply_to_provider_message_id"] == "msg-0"



def test_map_neonize_message_event_classifies_protocol_edit_and_uses_edited_content() -> None:
    event = FakeEvent(
        Info=FakeInfo(
            ID="msg-edit-1",
            MessageSource=FakeSource(
                Chat=FakeJID(User="1203630-group", Server="g.us"),
                Sender=FakeJID(User="4912345", Server="s.whatsapp.net"),
            ),
            Timestamp=datetime(2026, 4, 18, tzinfo=UTC),
        ),
        Message={
            "protocolMessage": {
                "type": "MESSAGE_EDIT",
                "editedMessage": {
                    "conversation": "updated hello",
                    "imageMessage": {
                        "URL": "https://example.com/edited.jpg",
                        "Mimetype": "image/jpeg",
                        "mediaKey": "edited-media-key",
                    },
                },
            },
        },
    )

    mapped = map_neonize_message_event(event)

    assert mapped["event_type"] == "message_edited"
    assert mapped["message"]["text"] == "updated hello"
    assert mapped["message"]["media"][0]["provider_media_id"] == "edited-media-key"



def test_map_neonize_message_event_classifies_revoke_as_deleted() -> None:
    event = FakeEvent(
        Info=FakeInfo(
            ID="msg-delete-1",
            MessageSource=FakeSource(
                Chat=FakeJID(User="1203630-group", Server="g.us"),
                Sender=FakeJID(User="4912345", Server="s.whatsapp.net"),
            ),
            Timestamp=datetime(2026, 4, 18, tzinfo=UTC),
        ),
        Message={
            "protocolMessage": {
                "type": "REVOKE",
                "key": {"id": "msg-original-1"},
            },
        },
    )

    mapped = map_neonize_message_event(event)

    assert mapped["event_type"] == "message_deleted"
    assert mapped["message"]["text"] is None
    assert mapped["message"]["media"] == []


def test_map_neonize_message_event_ignores_empty_media_shells() -> None:
    event = FakeEvent(
        Info=FakeInfo(
            ID="msg-media-empty",
            MessageSource=FakeSource(
                Chat=FakeJID(User="1203630-group", Server="g.us"),
                Sender=FakeJID(User="4912345", Server="s.whatsapp.net"),
            ),
            Timestamp=datetime(2026, 4, 18, tzinfo=UTC),
        ),
        Message={
            "conversation": "hi",
            "imageMessage": {
                "fileLength": "0",
                "mimetype": "",
            },
        },
    )

    mapped = map_neonize_message_event(event)

    assert mapped["message"]["media"] == []


def test_map_neonize_message_event_treats_b_empty_media_key_as_missing() -> None:
    event = FakeEvent(
        Info=FakeInfo(
            ID="msg-media-empty-key",
            MessageSource=FakeSource(
                Chat=FakeJID(User="1203630-group", Server="g.us"),
                Sender=FakeJID(User="4912345", Server="s.whatsapp.net"),
            ),
            Timestamp=datetime(2026, 4, 18, tzinfo=UTC),
        ),
        Message={
            "conversation": None,
            "imageMessage": {
                "URL": "https://example.com/image.jpg",
                "mimetype": "image/jpeg",
                "mediaKey": "b''",
            },
        },
    )

    mapped = map_neonize_message_event(event)
    media = mapped["message"]["media"][0]
    assert media["provider_media_id"].startswith("msg-media-empty-key:image")
