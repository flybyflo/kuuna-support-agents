from __future__ import annotations

import base64
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from kuuna_backend.config.settings import get_settings


class OpenAIIntegrationError(RuntimeError):
    """Raised when OpenAI integration calls fail."""


@dataclass(frozen=True, slots=True)
class AudioTranscriptionResult:
    text: str
    language: str | None


def is_openai_configured() -> bool:
    settings = get_settings()
    return bool(settings.openai_api_key)


def transcribe_audio_bytes(
    *,
    audio_bytes: bytes,
    mime_type: str | None,
    file_name: str | None,
) -> AudioTranscriptionResult:
    if not audio_bytes:
        raise OpenAIIntegrationError("audio payload is empty")

    settings = get_settings()
    if not settings.openai_api_key:
        raise OpenAIIntegrationError("OPENAI_API_KEY is not configured")

    safe_name = file_name or "media-audio"
    if "." not in safe_name:
        extension = _extension_for_mime_type(mime_type)
        safe_name = f"{safe_name}{extension}"

    files = {
        "file": (
            safe_name,
            audio_bytes,
            mime_type or "application/octet-stream",
        ),
    }
    data = {
        "model": settings.openai_audio_transcription_model,
        "response_format": "json",
    }

    response = httpx.post(
        f"{_base_url()}/audio/transcriptions",
        headers=_auth_headers(),
        files=files,
        data=data,
        timeout=get_settings().openai_timeout_seconds,
    )

    if response.status_code >= 400:
        raise OpenAIIntegrationError(
            f"openai_audio_transcription_http_{response.status_code}: {response.text[:300]}"
        )

    payload = response.json()
    text = str(payload.get("text") or "").strip()
    if not text:
        raise OpenAIIntegrationError("openai audio transcription returned empty text")

    language = payload.get("language")
    if language is not None:
        language = str(language)

    return AudioTranscriptionResult(text=text, language=language)


def describe_image_bytes(
    *,
    image_bytes: bytes,
    mime_type: str | None,
    instruction: str | None = None,
) -> str:
    if not image_bytes:
        raise OpenAIIntegrationError("image payload is empty")

    settings = get_settings()
    if not settings.openai_api_key:
        raise OpenAIIntegrationError("OPENAI_API_KEY is not configured")

    system_instruction = instruction or (
        "Extract readable text and relevant visual facts from this media. "
        "Keep output concise and factual."
    )

    data_url = _to_data_url(image_bytes=image_bytes, mime_type=mime_type)
    body = {
        "model": settings.openai_vision_model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system_instruction},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Provide transcript/context for retrieval."},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
    }

    response = httpx.post(
        f"{_base_url()}/chat/completions",
        headers={**_auth_headers(), "Content-Type": "application/json"},
        json=body,
        timeout=get_settings().openai_timeout_seconds,
    )

    if response.status_code >= 400:
        raise OpenAIIntegrationError(
            f"openai_vision_http_{response.status_code}: {response.text[:300]}"
        )

    payload = response.json()
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise OpenAIIntegrationError("openai vision returned no choices")

    content = _extract_chat_content(choices[0])
    if not content:
        raise OpenAIIntegrationError("openai vision returned empty content")

    return content


def create_chat_completion(
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.2,
) -> str:
    settings = get_settings()
    if not settings.openai_api_key:
        raise OpenAIIntegrationError("OPENAI_API_KEY is not configured")

    body = {
        "model": model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    response = httpx.post(
        f"{_base_url()}/chat/completions",
        headers={**_auth_headers(), "Content-Type": "application/json"},
        json=body,
        timeout=settings.openai_timeout_seconds,
    )

    if response.status_code >= 400:
        raise OpenAIIntegrationError(
            f"openai_chat_completion_http_{response.status_code}: {response.text[:300]}"
        )

    payload = response.json()
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise OpenAIIntegrationError("openai chat completion returned no choices")

    content = _extract_chat_content(choices[0])
    if not content:
        raise OpenAIIntegrationError("openai chat completion returned empty content")

    return content


def create_text_embedding(text: str) -> list[float]:
    embeddings = create_text_embeddings([text])
    return embeddings[0]


def create_text_embeddings(texts: Sequence[str]) -> list[list[float]]:
    if not texts:
        raise OpenAIIntegrationError("embedding input is empty")

    normalized_texts = [text if text.strip() else "__empty__" for text in texts]

    settings = get_settings()
    if not settings.openai_api_key:
        raise OpenAIIntegrationError("OPENAI_API_KEY is not configured")

    body = {
        "model": settings.openai_embedding_model,
        "input": normalized_texts,
    }

    response = httpx.post(
        f"{_base_url()}/embeddings",
        headers={**_auth_headers(), "Content-Type": "application/json"},
        json=body,
        timeout=settings.openai_timeout_seconds,
    )

    if response.status_code >= 400:
        raise OpenAIIntegrationError(
            f"openai_embeddings_http_{response.status_code}: {response.text[:300]}"
        )

    payload = response.json()
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        raise OpenAIIntegrationError("openai embeddings returned no data")

    vectors_by_index: dict[int, list[float]] = {}
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            raise OpenAIIntegrationError("openai embeddings payload item is invalid")

        raw_embedding = item.get("embedding")
        if not isinstance(raw_embedding, list) or not raw_embedding:
            raise OpenAIIntegrationError("openai embeddings payload is missing vector")

        vector_index = item.get("index", index)
        if not isinstance(vector_index, int):
            raise OpenAIIntegrationError("openai embeddings payload index is invalid")

        vectors_by_index[vector_index] = [float(component) for component in raw_embedding]

    ordered_vectors: list[list[float]] = []
    for vector_index in range(len(normalized_texts)):
        vector = vectors_by_index.get(vector_index)
        if vector is None:
            raise OpenAIIntegrationError("openai embeddings response is incomplete")
        ordered_vectors.append(vector)

    return ordered_vectors


def _extract_chat_content(choice: dict[str, Any]) -> str:
    message = choice.get("message")
    if not isinstance(message, dict):
        return ""

    content = message.get("content")
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text" and isinstance(item.get("text"), str):
                parts.append(item["text"].strip())
        return "\n".join(part for part in parts if part).strip()

    return ""


def _to_data_url(*, image_bytes: bytes, mime_type: str | None) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    normalized_mime = (mime_type or "image/jpeg").split(";", 1)[0].strip() or "image/jpeg"
    return f"data:{normalized_mime};base64,{encoded}"


def _auth_headers() -> dict[str, str]:
    settings = get_settings()
    if not settings.openai_api_key:
        return {}
    return {"Authorization": f"Bearer {settings.openai_api_key}"}


def _base_url() -> str:
    settings = get_settings()
    return settings.openai_base_url.rstrip("/")


def _extension_for_mime_type(mime_type: str | None) -> str:
    normalized = (mime_type or "").split(";", 1)[0].strip().lower()
    mapping = {
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
        "audio/x-m4a": ".m4a",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/webm": ".webm",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
    }
    return mapping.get(normalized, ".bin")
