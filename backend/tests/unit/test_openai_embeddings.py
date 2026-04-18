from __future__ import annotations

from types import SimpleNamespace

import pytest

from kuuna_backend.integrations import openai


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, object], text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict[str, object]:
        return self._payload


def test_create_text_embeddings_parses_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        openai,
        "get_settings",
        lambda: SimpleNamespace(
            openai_api_key="sk-test-key",
            openai_base_url="https://api.openai.com/v1",
            openai_timeout_seconds=30.0,
            openai_embedding_model="text-embedding-3-small",
        ),
    )

    def _fake_post(*_args, **_kwargs):
        return _FakeResponse(
            200,
            {
                "data": [
                    {"index": 1, "embedding": [0.3, 0.4]},
                    {"index": 0, "embedding": [0.1, 0.2]},
                ]
            },
        )

    monkeypatch.setattr(openai.httpx, "post", _fake_post)

    vectors = openai.create_text_embeddings(["a", "b"])
    assert vectors == [[0.1, 0.2], [0.3, 0.4]]


def test_create_text_embeddings_requires_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        openai,
        "get_settings",
        lambda: SimpleNamespace(
            openai_api_key=None,
            openai_base_url="https://api.openai.com/v1",
            openai_timeout_seconds=30.0,
            openai_embedding_model="text-embedding-3-small",
        ),
    )

    with pytest.raises(openai.OpenAIIntegrationError, match="OPENAI_API_KEY"):
        openai.create_text_embeddings(["hello"])
