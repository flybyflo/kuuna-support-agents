from __future__ import annotations

from uuid import uuid4

from kuuna_backend.db.models import MediaAsset, MediaStatus
from kuuna_backend.jobs import media_processing


def test_decode_data_url_roundtrip() -> None:
    decoded = media_processing._decode_data_url("data:text/plain;base64,aGVsbG8=")
    assert decoded is not None
    mime_type, payload = decoded
    assert mime_type == "text/plain"
    assert payload == b"hello"


def test_extract_transcript_for_text_document_returns_ready() -> None:
    asset = MediaAsset(
        message_id=uuid4(),
        provider_media_id="m-1",
        mime_type="text/plain; charset=utf-8",
    )

    extraction = media_processing._extract_transcript(
        asset=asset,
        content="hello world".encode("utf-8"),
        media_payload={},
    )

    assert extraction.status == MediaStatus.READY
    assert extraction.text_content == "hello world"


def test_extract_video_transcript_uses_caption_without_openai(monkeypatch) -> None:
    monkeypatch.setattr(media_processing, "is_openai_configured", lambda: False)

    extraction = media_processing._extract_video_transcript(
        content=None,
        media_payload={"caption": "Team update"},
        mime_type="video/mp4",
        file_name="clip.mp4",
    )

    assert extraction.status == MediaStatus.READY
    assert extraction.text_content == "Team update"
