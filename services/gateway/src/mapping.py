from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

try:
    from google.protobuf.json_format import MessageToDict
    from google.protobuf.message import Message as ProtobufMessage
except Exception:  # pragma: no cover - optional dependency in scaffold stage
    MessageToDict = None
    ProtobufMessage = None


def _is_protobuf_message(value: Any) -> bool:
    return ProtobufMessage is not None and isinstance(value, ProtobufMessage)


def _protobuf_to_dict(value: Any) -> dict[str, Any]:
    if MessageToDict is None:
        return {"_error": "protobuf runtime unavailable"}
    try:
        return MessageToDict(
            value,
            preserving_proto_field_name=True,
            always_print_fields_with_no_presence=True,
        )
    except TypeError:
        # compatibility with older protobuf versions
        return MessageToDict(value, preserving_proto_field_name=True)


def _to_jsonable(value: Any, *, depth: int = 0) -> Any:
    if depth > 8:
        return str(value)

    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()

    if _is_protobuf_message(value):
        return _protobuf_to_dict(value)

    if is_dataclass(value):
        return _to_jsonable(asdict(value), depth=depth + 1)

    if isinstance(value, dict):
        return {str(k): _to_jsonable(v, depth=depth + 1) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [_to_jsonable(v, depth=depth + 1) for v in value]

    if hasattr(value, "__dict__"):
        raw = {
            k: v
            for k, v in vars(value).items()
            if not k.startswith("_") and not callable(v)
        }
        return _to_jsonable(raw, depth=depth + 1)

    return str(value)


def _get_path(obj: Any, *path: str, default: Any = None) -> Any:
    current = obj
    for key in path:
        if current is None:
            return default
        if isinstance(current, dict):
            current = current.get(key)
            continue
        current = getattr(current, key, None)
    return default if current is None else current


def _jid_to_str(jid: Any) -> str | None:
    if jid is None:
        return None
    if isinstance(jid, str):
        return jid

    user = getattr(jid, "User", None) or getattr(jid, "user", None)
    server = getattr(jid, "Server", None) or getattr(jid, "server", None)
    if user and server:
        return f"{user}@{server}"

    return str(jid)


def _extract_text(message_obj: Any) -> str | None:
    direct = _get_path(message_obj, "conversation")
    if direct:
        return str(direct)

    extended = _get_path(message_obj, "extendedTextMessage", "text")
    if extended:
        return str(extended)

    return None


def _extract_reply_and_mentions(message_obj: Any) -> tuple[str | None, list[str]]:
    context = _get_path(message_obj, "extendedTextMessage", "contextInfo")
    if context is None:
        return None, []

    reply_to = _get_path(context, "stanzaID") or _get_path(context, "stanzaId")

    mentioned = _get_path(context, "mentionedJID", default=[])
    mentions = [_jid_to_str(item) or str(item) for item in (mentioned or [])]

    return (str(reply_to) if reply_to else None), mentions


def _extract_media(message_obj: Any, provider_message_id: str) -> list[dict[str, Any]]:
    media_fields: list[tuple[str, str]] = [
        ("imageMessage", "image"),
        ("videoMessage", "video"),
        ("audioMessage", "audio"),
        ("documentMessage", "document"),
        ("stickerMessage", "sticker"),
    ]

    media_items: list[dict[str, Any]] = []
    for field_name, kind in media_fields:
        media_obj = _get_path(message_obj, field_name)
        if media_obj is None:
            continue

        mime_type = _get_path(media_obj, "mimetype") or _get_path(media_obj, "mimeType")
        file_name = _get_path(media_obj, "fileName")
        size = _get_path(media_obj, "fileLength")
        url = _get_path(media_obj, "url")
        media_key = _get_path(media_obj, "mediaKey")

        provider_media_id = None
        if media_key is not None:
            provider_media_id = str(media_key)
        if provider_media_id is None:
            provider_media_id = f"{provider_message_id}:{kind}"

        media_items.append(
            {
                "provider_media_id": provider_media_id,
                "mime_type": str(mime_type) if mime_type else f"application/{kind}",
                "file_name": str(file_name) if file_name else None,
                "byte_size": int(size) if isinstance(size, (int, float, str)) and str(size).isdigit() else None,
                "download_url": str(url) if url else None,
            }
        )

    return media_items


def map_neonize_message_event(event: Any) -> dict[str, Any]:
    """Map a Neonize MessageEv object to the backend inbound contract.

    The full provider event is preserved in `raw_event` for durable storage.
    """

    info = _get_path(event, "Info")
    message = _get_path(event, "Message")

    provider_message_id = _get_path(info, "ID") or _get_path(info, "Id") or str(uuid4())
    chat = _get_path(info, "MessageSource", "Chat")
    sender = _get_path(info, "MessageSource", "Sender")

    provider_group_id = _jid_to_str(chat) or ""
    sender_provider_user_id = _jid_to_str(sender)

    timestamp = _get_path(info, "Timestamp")
    if isinstance(timestamp, datetime):
        occurred_at = timestamp.astimezone(UTC).isoformat()
    else:
        occurred_at = datetime.now(UTC).isoformat()

    reply_to, mentions = _extract_reply_and_mentions(message)

    payload = {
        "trace_id": str(uuid4()),
        "provider": "whatsapp-neonize",
        "provider_group_id": provider_group_id,
        "provider_message_id": str(provider_message_id),
        "sender_provider_user_id": sender_provider_user_id,
        "event_type": "message_created",
        "occurred_at": occurred_at,
        "message": {
            "text": _extract_text(message),
            "reply_to_provider_message_id": reply_to,
            "mentions": mentions,
            "media": _extract_media(message, str(provider_message_id)),
        },
        "raw_event": _to_jsonable(event),
    }

    return payload
