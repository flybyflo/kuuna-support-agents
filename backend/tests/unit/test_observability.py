from __future__ import annotations

from kuuna_backend import main


def test_scrub_string_masks_openai_key_like_tokens() -> None:
    value = "token sk-abcdefghijklmnopqrstuvwxyz123456 should be hidden"
    scrubbed = main._scrub_string(value)
    assert "sk-abcdefghijklmnopqrstuvwxyz123456" not in scrubbed
    assert "[REDACTED]" in scrubbed


def test_scrub_value_redacts_sensitive_keys_recursively() -> None:
    event = {
        "raw_event": {"message": "hello"},
        "payload": {
            "download_url": "https://example.com/file",
            "nested": {"authorization": "Bearer abc"},
        },
    }

    scrubbed = main._scrub_value("event", event)
    assert scrubbed["raw_event"] == "[REDACTED]"
    assert scrubbed["payload"]["download_url"] == "[REDACTED]"
    assert scrubbed["payload"]["nested"]["authorization"] == "[REDACTED]"
