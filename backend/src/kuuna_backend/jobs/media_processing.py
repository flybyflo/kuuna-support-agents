from __future__ import annotations

import base64
import binascii
import importlib
import logging
import mimetypes
from dataclasses import dataclass
from io import BytesIO
from typing import Any
from urllib.parse import unquote_to_bytes
from uuid import UUID

import httpx
from sqlalchemy import delete, func, select

try:  # optional dependency in current runtime image
    _pypdf_module = importlib.import_module("pypdf")
    _PdfReader: Any | None = getattr(_pypdf_module, "PdfReader", None)
except Exception:  # pragma: no cover - handled gracefully when parsing PDFs
    _PdfReader = None

from kuuna_backend.config.settings import get_settings
from kuuna_backend.db.models import MediaAsset, MediaStatus, Message, MessageVersion, Transcript
from kuuna_backend.integrations.openai import (
    OpenAIIntegrationError,
    describe_image_bytes,
    is_openai_configured,
    transcribe_audio_bytes,
)
from kuuna_backend.integrations.postgres import get_db_session
from kuuna_backend.integrations.s3 import create_presigned_get_url, upload_bytes
from kuuna_backend.jobs.queue import enqueue_passive_message_analysis, enqueue_retrieval_indexing

logger = logging.getLogger(__name__)


def _safe_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _lookup_case_insensitive(value: dict[str, Any], keys: list[str]) -> Any:
    if not value:
        return None

    for key in keys:
        if key in value:
            return value[key]

    lowered = {str(key).lower(): item for key, item in value.items()}
    for key in keys:
        candidate = lowered.get(key.lower())
        if candidate is not None:
            return candidate

    return None


def _normalize_mime_type(mime_type: str | None) -> str:
    return (mime_type or "").split(";", 1)[0].strip().lower()


def _kind_from_mime_type(mime_type: str) -> str:
    normalized = _normalize_mime_type(mime_type)

    if normalized.startswith("image/") or normalized.endswith("/image"):
        return "image"
    if normalized.startswith("video/") or normalized.endswith("/video"):
        return "video"
    if normalized.startswith("audio/") or normalized.endswith("/audio"):
        return "audio"
    if normalized.startswith("application/sticker") or normalized.endswith("/sticker"):
        return "sticker"
    if normalized.startswith("application/document") or normalized.endswith("/document"):
        return "document"

    return "file"


def _media_field_candidates(kind: str) -> list[str]:
    if kind == "image":
        return ["imageMessage", "ImageMessage"]
    if kind == "video":
        return ["videoMessage", "VideoMessage"]
    if kind == "audio":
        return ["audioMessage", "AudioMessage"]
    if kind == "document":
        return ["documentMessage", "DocumentMessage"]
    if kind == "sticker":
        return ["stickerMessage", "StickerMessage"]
    return []


def _extract_media_payload(raw_event: dict[str, Any], kind: str) -> dict[str, Any]:
    containers = [
        _safe_dict(raw_event.get("Message")),
        _safe_dict(raw_event.get("Raw")),
        raw_event,
    ]

    field_candidates = _media_field_candidates(kind)
    for container in containers:
        for field_name in field_candidates:
            payload = container.get(field_name)
            if isinstance(payload, dict):
                return payload

    return {}


def _extract_download_url(media_payload: dict[str, Any]) -> str | None:
    value = _lookup_case_insensitive(media_payload, ["url", "URL"])
    if isinstance(value, str) and value:
        return value
    return None


def _extract_thumbnail_data_url(media_payload: dict[str, Any]) -> str | None:
    thumbnail = _lookup_case_insensitive(media_payload, ["jpegThumbnail", "JPEGThumbnail"])
    if isinstance(thumbnail, str) and thumbnail:
        return f"data:image/jpeg;base64,{thumbnail}"

    if isinstance(thumbnail, bytes) and thumbnail:
        encoded = base64.b64encode(thumbnail).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"

    return None


def _extract_payload_mime_type(media_payload: dict[str, Any]) -> str | None:
    value = _lookup_case_insensitive(media_payload, ["mimetype", "mimeType", "Mimetype", "MimeType"])
    if isinstance(value, str) and value:
        return value
    return None


def _build_object_key(*, provider_group_id: str, message_id: UUID, media_id: UUID, mime_type: str) -> str:
    extension = mimetypes.guess_extension(mime_type or "") or ""
    safe_group = provider_group_id.replace("@", "_at_").replace("/", "_")
    return f"media/{safe_group}/{message_id}/{media_id}{extension}"


def _public_url_from_key(*, object_key: str, bucket_name: str) -> str | None:
    settings = get_settings()
    if not settings.s3_public_base_url:
        return None

    base = settings.s3_public_base_url.rstrip("/")
    return f"{base}/{bucket_name}/{object_key}"


def _is_text_transcript_mime_type(mime_type: str | None) -> bool:
    normalized = _normalize_mime_type(mime_type)
    return normalized.startswith("text/") or normalized in {
        "application/markdown",
        "application/x-markdown",
    }


def _is_pdf_mime_type(mime_type: str | None) -> bool:
    normalized = _normalize_mime_type(mime_type)
    return normalized in {"application/pdf", "application/x-pdf"}


def _charset_candidates(mime_type: str | None) -> list[str]:
    candidates: list[str] = []
    for part in (mime_type or "").split(";")[1:]:
        key, _, value = part.partition("=")
        if key.strip().lower() != "charset":
            continue

        charset = value.strip().strip('"').strip("'")
        if charset:
            candidates.append(charset)

    return candidates


def _decode_text_bytes(data: bytes, mime_type: str | None) -> str:
    encodings = _charset_candidates(mime_type)
    for fallback in ("utf-8-sig", "utf-8", "utf-16", "utf-16-le", "utf-16-be", "cp1252", "latin-1"):
        if fallback not in encodings:
            encodings.append(fallback)

    for encoding in encodings:
        try:
            return data.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue

    return data.decode("utf-8", errors="replace")


def _truncate_text(value: str, max_length: int = 280) -> str:
    compact = " ".join(value.split())
    if len(compact) <= max_length:
        return compact
    return f"{compact[: max_length - 1].rstrip()}…"


def _transcript_placeholder(*, kind: str, mime_type: str | None) -> str:
    normalized = _normalize_mime_type(mime_type)
    if normalized == "application/pdf":
        media_label = "pdf"
    elif kind in {"audio", "video", "image", "sticker"}:
        media_label = kind
    else:
        media_label = normalized or "file"

    return f"Transcript pending for {media_label} media."


@dataclass(frozen=True, slots=True)
class TranscriptExtraction:
    status: MediaStatus
    text_content: str | None
    language: str | None = None


def _extract_caption_text(media_payload: dict[str, Any]) -> str | None:
    value = _lookup_case_insensitive(media_payload, ["caption", "Caption", "text", "Text"])
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _decode_data_url(data_url: str) -> tuple[str | None, bytes] | None:
    if not data_url.startswith("data:"):
        return None

    header, sep, payload = data_url.partition(",")
    if not sep:
        return None

    header = header[5:]
    parts = [part.strip() for part in header.split(";") if part.strip()]
    mime_type: str | None = None
    is_base64 = False
    for part in parts:
        if part.lower() == "base64":
            is_base64 = True
            continue
        if "/" in part and mime_type is None:
            mime_type = part.lower()

    try:
        if is_base64:
            raw = base64.b64decode(payload, validate=True)
        else:
            raw = unquote_to_bytes(payload)
    except (binascii.Error, ValueError):
        return None

    return mime_type, raw


def _extract_thumbnail_bytes(media_payload: dict[str, Any]) -> bytes | None:
    thumbnail = _lookup_case_insensitive(media_payload, ["jpegThumbnail", "JPEGThumbnail"])
    if isinstance(thumbnail, bytes) and thumbnail:
        return thumbnail

    if isinstance(thumbnail, str) and thumbnail:
        try:
            return base64.b64decode(thumbnail, validate=True)
        except (binascii.Error, ValueError):
            return None

    return None


def _extract_pdf_text(content: bytes) -> str:
    if not content:
        return ""

    if _PdfReader is None:
        raise RuntimeError("pypdf not installed")

    reader = _PdfReader(BytesIO(content))
    parts: list[str] = []
    for page in reader.pages:
        text = (page.extract_text() or "").strip()
        if text:
            parts.append(text)

    return "\n\n".join(parts).strip()


def _extract_text_document(content: bytes, mime_type: str | None) -> TranscriptExtraction:
    transcript_text = _decode_text_bytes(content, mime_type).strip()
    if transcript_text:
        return TranscriptExtraction(status=MediaStatus.READY, text_content=transcript_text)

    return TranscriptExtraction(
        status=MediaStatus.FAILED,
        text_content="Transcript failed: empty text document",
    )


def _extract_image_transcript(
    *,
    content: bytes | None,
    media_payload: dict[str, Any],
    mime_type: str | None,
) -> TranscriptExtraction:
    caption = _extract_caption_text(media_payload)

    image_bytes = content
    image_mime = _normalize_mime_type(mime_type) or "image/jpeg"
    thumbnail_data_url = _extract_thumbnail_data_url(media_payload)
    if (not image_bytes) and isinstance(thumbnail_data_url, str):
        decoded = _decode_data_url(thumbnail_data_url)
        if decoded is not None:
            decoded_mime, decoded_bytes = decoded
            image_mime = decoded_mime or image_mime
            image_bytes = decoded_bytes

    analysis_text: str | None = None
    if image_bytes and is_openai_configured():
        try:
            analysis_text = describe_image_bytes(
                image_bytes=image_bytes,
                mime_type=image_mime,
            )
        except OpenAIIntegrationError as exc:
            logger.warning("media_image_analysis_failed", extra={"reason": str(exc)})

    parts = [part for part in (caption, analysis_text) if part]
    if parts:
        merged = "\n\n".join(dict.fromkeys(part.strip() for part in parts if part.strip()))
        return TranscriptExtraction(status=MediaStatus.READY, text_content=merged)

    return TranscriptExtraction(
        status=MediaStatus.PENDING,
        text_content=_transcript_placeholder(kind="image", mime_type=mime_type),
    )


def _extract_audio_transcript(
    *,
    content: bytes | None,
    mime_type: str | None,
    file_name: str | None,
) -> TranscriptExtraction:
    if not content:
        return TranscriptExtraction(
            status=MediaStatus.PENDING,
            text_content=_transcript_placeholder(kind="audio", mime_type=mime_type),
        )

    if not is_openai_configured():
        return TranscriptExtraction(
            status=MediaStatus.PENDING,
            text_content="Transcript pending: OPENAI_API_KEY not configured.",
        )

    try:
        transcription = transcribe_audio_bytes(
            audio_bytes=content,
            mime_type=mime_type,
            file_name=file_name,
        )
    except OpenAIIntegrationError as exc:
        return TranscriptExtraction(
            status=MediaStatus.FAILED,
            text_content=f"Transcript failed: {_truncate_text(str(exc))}",
        )

    return TranscriptExtraction(
        status=MediaStatus.READY,
        text_content=transcription.text,
        language=transcription.language,
    )


def _extract_video_transcript(
    *,
    content: bytes | None,
    media_payload: dict[str, Any],
    mime_type: str | None,
    file_name: str | None,
) -> TranscriptExtraction:
    parts: list[str] = []
    language: str | None = None

    caption = _extract_caption_text(media_payload)
    if caption:
        parts.append(caption)

    audio_result = _extract_audio_transcript(content=content, mime_type=mime_type, file_name=file_name)
    if audio_result.status == MediaStatus.READY and audio_result.text_content:
        parts.append(audio_result.text_content)
        language = audio_result.language

    thumbnail_bytes = _extract_thumbnail_bytes(media_payload)
    if thumbnail_bytes and is_openai_configured():
        try:
            frame_text = describe_image_bytes(
                image_bytes=thumbnail_bytes,
                mime_type="image/jpeg",
                instruction="Describe the video frame and extract visible text.",
            )
            if frame_text:
                parts.append(frame_text)
        except OpenAIIntegrationError as exc:
            logger.warning("media_video_frame_analysis_failed", extra={"reason": str(exc)})

    normalized_parts = [part.strip() for part in parts if part.strip()]
    if normalized_parts:
        merged = "\n\n".join(dict.fromkeys(normalized_parts))
        return TranscriptExtraction(status=MediaStatus.READY, text_content=merged, language=language)

    if audio_result.status == MediaStatus.FAILED:
        return audio_result

    return TranscriptExtraction(
        status=MediaStatus.PENDING,
        text_content=_transcript_placeholder(kind="video", mime_type=mime_type),
    )


def _extract_transcript(
    *,
    asset: MediaAsset,
    content: bytes | None,
    media_payload: dict[str, Any],
) -> TranscriptExtraction:
    normalized_mime = _normalize_mime_type(asset.mime_type)
    kind = _kind_from_mime_type(asset.mime_type)

    if _is_text_transcript_mime_type(normalized_mime):
        return _extract_text_document(content or b"", asset.mime_type)

    if _is_pdf_mime_type(normalized_mime):
        try:
            pdf_text = _extract_pdf_text(content or b"")
        except Exception as exc:
            return TranscriptExtraction(
                status=MediaStatus.FAILED,
                text_content=f"Transcript failed: {_truncate_text(str(exc) or 'pdf_parse_error')}",
            )

        if pdf_text:
            return TranscriptExtraction(status=MediaStatus.READY, text_content=pdf_text)

        return TranscriptExtraction(
            status=MediaStatus.FAILED,
            text_content="Transcript failed: PDF text is empty",
        )

    if kind in {"image", "sticker"}:
        return _extract_image_transcript(content=content, media_payload=media_payload, mime_type=asset.mime_type)

    if kind == "audio":
        return _extract_audio_transcript(content=content, mime_type=asset.mime_type, file_name=asset.file_name)

    if kind == "video":
        return _extract_video_transcript(
            content=content,
            media_payload=media_payload,
            mime_type=asset.mime_type,
            file_name=asset.file_name,
        )

    return TranscriptExtraction(
        status=MediaStatus.PENDING,
        text_content=_transcript_placeholder(kind=kind, mime_type=asset.mime_type),
    )


def _upsert_transcript(
    db: Any,
    *,
    media_asset_id: UUID,
    status: MediaStatus,
    text_content: str | None,
    language: str | None = None,
) -> None:
    transcript = db.execute(select(Transcript).where(Transcript.media_asset_id == media_asset_id)).scalar_one_or_none()

    if transcript is None:
        transcript = Transcript(
            media_asset_id=media_asset_id,
            status=status,
            text_content=text_content,
            language=language,
        )
        db.add(transcript)
        return

    transcript.status = status
    transcript.text_content = text_content
    if language is not None or transcript.language is None:
        transcript.language = language


def _upsert_success_transcript(
    db: Any,
    *,
    asset: MediaAsset,
    content: bytes | None = None,
    media_payload: dict[str, Any] | None = None,
) -> None:
    extraction = _extract_transcript(
        asset=asset,
        content=content,
        media_payload=media_payload or {},
    )

    _upsert_transcript(
        db,
        media_asset_id=asset.id,
        status=extraction.status,
        text_content=extraction.text_content,
        language=extraction.language,
    )


def _upsert_failed_transcript(db: Any, *, media_asset_id: UUID, error: Exception | str) -> None:
    error_text = error if isinstance(error, str) else str(error)
    failure_hint = _truncate_text(error_text or "unknown_error")
    _upsert_transcript(
        db,
        media_asset_id=media_asset_id,
        status=MediaStatus.FAILED,
        text_content=f"Transcript failed: {failure_hint}",
    )


def _enqueue_media_followups(
    *,
    asset: MediaAsset,
    provider_group_id: str,
    trace_id: str | None,
    reason: str,
) -> None:
    try:
        enqueue_retrieval_indexing("media_asset", str(asset.id), trace_id)
    except Exception:
        logger.exception(
            "media_retrieval_indexing_enqueue_failed",
            extra={
                "trace_id": trace_id,
                "media_asset_id": str(asset.id),
                "provider_group_id": provider_group_id,
            },
        )

    try:
        enqueue_passive_message_analysis(
            message_id=str(asset.message_id),
            provider_group_id=provider_group_id,
            reason=reason,
            trace_id=trace_id,
        )
    except Exception:
        logger.exception(
            "media_passive_analysis_enqueue_failed",
            extra={
                "trace_id": trace_id,
                "media_asset_id": str(asset.id),
                "message_id": str(asset.message_id),
                "provider_group_id": provider_group_id,
            },
        )


def process_media_asset_job(media_asset_id: str, trace_id: str | None = None) -> None:
    settings = get_settings()

    if not settings.media_processing_enabled:
        logger.info("media_processing_disabled", extra={"trace_id": trace_id, "media_asset_id": media_asset_id})
        return

    db = get_db_session()
    try:
        asset_uuid = UUID(media_asset_id)
        asset = db.execute(select(MediaAsset).where(MediaAsset.id == asset_uuid)).scalar_one_or_none()

        if asset is None:
            logger.warning("media_asset_not_found", extra={"trace_id": trace_id, "media_asset_id": media_asset_id})
            return

        if asset.status != MediaStatus.PENDING:
            logger.info(
                "media_asset_already_processed",
                extra={"trace_id": trace_id, "media_asset_id": media_asset_id, "status": asset.status.value},
            )
            return

        metadata = dict(asset.metadata_json or {})
        kind = _kind_from_mime_type(asset.mime_type)

        raw_event = db.execute(
            select(MessageVersion.raw_event)
            .where(MessageVersion.message_id == asset.message_id)
            .order_by(MessageVersion.version_no.desc())
            .limit(1)
        ).scalar_one_or_none()

        media_payload = _extract_media_payload(_safe_dict(raw_event), kind)

        payload_mime_type = _extract_payload_mime_type(media_payload)
        if payload_mime_type and asset.mime_type.startswith("application/"):
            asset.mime_type = payload_mime_type

        download_url = metadata.get("download_url") if isinstance(metadata.get("download_url"), str) else None
        if not download_url:
            download_url = _extract_download_url(media_payload)
            if download_url:
                metadata["download_url"] = download_url

        inline_data_base64_raw = metadata.get("inline_data_base64")
        inline_data_base64: str | None = (
            inline_data_base64_raw if isinstance(inline_data_base64_raw, str) else None
        )
        downloaded_bytes: bytes | None = None
        used_inline_data = False

        if inline_data_base64:
            try:
                downloaded_bytes = base64.b64decode(inline_data_base64, validate=True)
                used_inline_data = True
            except (binascii.Error, ValueError):
                metadata["inline_data_invalid"] = True

        if kind == "image" and "preview_url" not in metadata:
            thumbnail_data_url = _extract_thumbnail_data_url(media_payload)
            if thumbnail_data_url:
                metadata["preview_url"] = thumbnail_data_url

        if downloaded_bytes is None and not download_url:
            if kind == "image" and isinstance(metadata.get("preview_url"), str):
                provider_group_id = db.execute(
                    select(Message.provider_group_id).where(Message.id == asset.message_id).limit(1)
                ).scalar_one_or_none() or "unknown"
                asset.status = MediaStatus.READY
                metadata["processing_mode"] = "thumbnail-only"
                asset.metadata_json = metadata
                _upsert_success_transcript(db, asset=asset, media_payload=media_payload)
                db.commit()
                _enqueue_media_followups(
                    asset=asset,
                    provider_group_id=provider_group_id,
                    trace_id=trace_id,
                    reason="media_processed",
                )
                logger.info(
                    "media_asset_ready_thumbnail_only",
                    extra={"trace_id": trace_id, "media_asset_id": media_asset_id, "kind": kind},
                )
                return

            asset.status = MediaStatus.FAILED
            metadata["error"] = "download_url_missing"
            asset.metadata_json = metadata
            _upsert_failed_transcript(db, media_asset_id=asset.id, error="download_url_missing")
            db.commit()
            logger.warning(
                "media_asset_failed_missing_download_url",
                extra={"trace_id": trace_id, "media_asset_id": media_asset_id, "kind": kind},
            )
            return

        if downloaded_bytes is None:
            response = httpx.get(
                str(download_url),
                timeout=settings.media_download_timeout_seconds,
                follow_redirects=True,
            )
            response.raise_for_status()
            downloaded_bytes = response.content

        provider_group_id = db.execute(
            select(Message.provider_group_id).where(Message.id == asset.message_id).limit(1)
        ).scalar_one_or_none() or "unknown"

        if downloaded_bytes is None:
            raise RuntimeError("media bytes unavailable after download stage")

        object_key = _build_object_key(
            provider_group_id=provider_group_id,
            message_id=asset.message_id,
            media_id=asset.id,
            mime_type=asset.mime_type,
        )

        upload_bytes(
            bucket_name=settings.s3_bucket,
            object_key=object_key,
            data=downloaded_bytes,
            content_type=asset.mime_type,
        )

        asset.s3_key = object_key
        asset.status = MediaStatus.READY
        metadata["byte_size_downloaded"] = len(downloaded_bytes)

        object_url = _public_url_from_key(object_key=object_key, bucket_name=settings.s3_bucket)
        if not object_url:
            object_url = create_presigned_get_url(
                bucket_name=settings.s3_bucket,
                object_key=object_key,
                expires_in_seconds=7 * 24 * 60 * 60,
            )

        metadata["object_url"] = object_url
        metadata["source_download_url"] = download_url
        if kind == "image":
            existing_preview = metadata.get("preview_url")
            has_inline_thumbnail = isinstance(existing_preview, str) and existing_preview.startswith(
                "data:image/"
            )

            if used_inline_data and inline_data_base64:
                metadata["preview_url"] = f"data:{asset.mime_type};base64,{inline_data_base64}"
            elif has_inline_thumbnail:
                pass
            elif settings.s3_public_base_url:
                metadata["preview_url"] = object_url
            else:
                metadata["preview_url"] = download_url

        metadata.pop("inline_data_base64", None)

        asset.metadata_json = metadata
        _upsert_success_transcript(
            db,
            asset=asset,
            content=downloaded_bytes,
            media_payload=media_payload,
        )
        db.commit()
        _enqueue_media_followups(
            asset=asset,
            provider_group_id=provider_group_id,
            trace_id=trace_id,
            reason="media_processed",
        )

        logger.info(
            "media_asset_processed",
            extra={
                "trace_id": trace_id,
                "media_asset_id": media_asset_id,
                "status": asset.status.value,
                "object_key": object_key,
                "kind": kind,
            },
        )
    except Exception as exc:
        db.rollback()

        try:
            asset_uuid = UUID(media_asset_id)
            failed_asset = db.execute(select(MediaAsset).where(MediaAsset.id == asset_uuid)).scalar_one_or_none()
            if failed_asset is not None:
                metadata = dict(failed_asset.metadata_json or {})
                metadata["error"] = str(exc)
                failed_asset.status = MediaStatus.FAILED
                failed_asset.metadata_json = metadata
                _upsert_failed_transcript(db, media_asset_id=failed_asset.id, error=exc)
                db.commit()
        except Exception:
            db.rollback()

        logger.exception("media_asset_processing_failed", extra={"trace_id": trace_id, "media_asset_id": media_asset_id})
    finally:
        db.close()


def _scope_media_asset_ids_query(provider_group_id: str | None) -> Any:
    query = select(MediaAsset.id)
    if provider_group_id:
        query = query.join(Message, Message.id == MediaAsset.message_id).where(
            Message.provider_group_id == provider_group_id
        )
    return query


def get_media_reconcile_snapshot(provider_group_id: str | None = None) -> dict[str, int]:
    db = get_db_session()
    try:
        base = _scope_media_asset_ids_query(provider_group_id).subquery()

        pending = db.execute(
            select(func.count())
            .select_from(MediaAsset)
            .where(MediaAsset.id.in_(select(base.c.id)), MediaAsset.status == MediaStatus.PENDING)
        ).scalar_one()

        failed = db.execute(
            select(func.count())
            .select_from(MediaAsset)
            .where(MediaAsset.id.in_(select(base.c.id)), MediaAsset.status == MediaStatus.FAILED)
        ).scalar_one()

        failed_bogus = db.execute(
            select(func.count())
            .select_from(MediaAsset)
            .where(
                MediaAsset.id.in_(select(base.c.id)),
                MediaAsset.status == MediaStatus.FAILED,
                MediaAsset.provider_media_id == "b''",
            )
        ).scalar_one()

        ready = db.execute(
            select(func.count())
            .select_from(MediaAsset)
            .where(MediaAsset.id.in_(select(base.c.id)), MediaAsset.status == MediaStatus.READY)
        ).scalar_one()

        return {
            "pending": int(pending),
            "failed": int(failed),
            "failed_bogus": int(failed_bogus),
            "ready": int(ready),
        }
    finally:
        db.close()


def enqueue_pending_media_assets(limit: int = 500, provider_group_id: str | None = None) -> int:
    from kuuna_backend.jobs.queue import enqueue_media_processing

    db = get_db_session()
    try:
        query = select(MediaAsset.id)
        if provider_group_id:
            query = query.join(Message, Message.id == MediaAsset.message_id).where(
                Message.provider_group_id == provider_group_id
            )

        rows = db.execute(
            query.where(MediaAsset.status == MediaStatus.PENDING)
            .order_by(MediaAsset.created_at.asc())
            .limit(limit)
        ).scalars()

        count = 0
        for media_asset_id in rows:
            enqueue_media_processing(str(media_asset_id))
            count += 1

        return count
    finally:
        db.close()


def enqueue_failed_media_assets_for_retry(
    limit: int = 500,
    provider_group_id: str | None = None,
) -> int:
    from kuuna_backend.jobs.queue import enqueue_media_processing

    db = get_db_session()
    try:
        query = select(MediaAsset)
        if provider_group_id:
            query = query.join(Message, Message.id == MediaAsset.message_id).where(
                Message.provider_group_id == provider_group_id
            )

        rows = db.execute(
            query.where(MediaAsset.status == MediaStatus.FAILED)
            .order_by(MediaAsset.updated_at.asc())
            .limit(limit)
        ).scalars()

        count = 0
        for asset in rows:
            metadata = dict(asset.metadata_json or {})
            metadata.pop("error", None)
            asset.status = MediaStatus.PENDING
            asset.metadata_json = metadata
            enqueue_media_processing(str(asset.id))
            count += 1

        db.commit()
        return count
    finally:
        db.close()


def cleanup_bogus_failed_assets(limit: int = 5000, provider_group_id: str | None = None) -> int:
    db = get_db_session()
    try:
        query = select(MediaAsset.id).where(
            MediaAsset.status == MediaStatus.FAILED,
            MediaAsset.provider_media_id == "b''",
        )

        if provider_group_id:
            query = query.join(Message, Message.id == MediaAsset.message_id).where(
                Message.provider_group_id == provider_group_id
            )

        bogus_ids = db.execute(query.limit(limit)).scalars().all()

        if not bogus_ids:
            return 0

        db.execute(delete(MediaAsset).where(MediaAsset.id.in_(bogus_ids)))
        db.commit()
        return len(bogus_ids)
    finally:
        db.close()


def backfill_image_previews_from_raw(
    limit: int = 500,
    provider_group_id: str | None = None,
) -> int:
    db = get_db_session()
    try:
        query = select(MediaAsset).where(
            MediaAsset.status == MediaStatus.READY,
            MediaAsset.mime_type.like("image/%"),
        )

        if provider_group_id:
            query = query.join(Message, Message.id == MediaAsset.message_id).where(
                Message.provider_group_id == provider_group_id
            )

        assets = db.execute(query.order_by(MediaAsset.updated_at.desc()).limit(limit)).scalars()

        updated = 0
        for asset in assets:
            metadata = dict(asset.metadata_json or {})
            current_preview = metadata.get("preview_url")
            has_inline_preview = isinstance(current_preview, str) and current_preview.startswith(
                "data:image/"
            )
            if has_inline_preview:
                continue

            raw_event = db.execute(
                select(MessageVersion.raw_event)
                .where(MessageVersion.message_id == asset.message_id)
                .order_by(MessageVersion.version_no.desc())
                .limit(1)
            ).scalar_one_or_none()

            media_payload = _extract_media_payload(_safe_dict(raw_event), "image")
            thumbnail_data_url = _extract_thumbnail_data_url(media_payload)
            if not thumbnail_data_url:
                continue

            metadata["preview_url"] = thumbnail_data_url
            asset.metadata_json = metadata
            updated += 1

        if updated:
            db.commit()

        return updated
    finally:
        db.close()
