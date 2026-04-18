from __future__ import annotations

import logging
import os
from typing import Any
from uuid import UUID

import httpx
from rq import get_current_job

from kuuna_backend.db.models import OutboundStatus
from kuuna_backend.domain.outbound.service import (
    get_outbound_intent,
    mark_outbound_intent_failed,
    mark_outbound_intent_retrying,
    mark_outbound_intent_sending,
    mark_outbound_intent_sent,
)
from kuuna_backend.integrations.postgres import get_db_session

logger = logging.getLogger(__name__)

DEFAULT_GATEWAY_BASE_URL = "http://gateway:8090"
DEFAULT_OUTBOUND_TIMEOUT_SECONDS = 10.0
TRANSIENT_HTTP_STATUS_CODES = frozenset({408, 425, 429, 500, 502, 503, 504})


class OutboundDispatchError(RuntimeError):
    """Raised when an outbound intent cannot be dispatched."""


class OutboundDispatchRetryableError(OutboundDispatchError):
    """Raised when an outbound intent should be retried by RQ."""


def _gateway_base_url() -> str:
    return os.getenv("GATEWAY_BASE_URL", DEFAULT_GATEWAY_BASE_URL).rstrip("/")


def _gateway_timeout_seconds() -> float:
    raw_value = os.getenv("OUTBOUND_DISPATCH_TIMEOUT_SECONDS")
    if not raw_value:
        return DEFAULT_OUTBOUND_TIMEOUT_SECONDS

    try:
        return float(raw_value)
    except ValueError:
        logger.warning(
            "outbound_dispatch_invalid_timeout",
            extra={"timeout_value": raw_value},
        )
        return DEFAULT_OUTBOUND_TIMEOUT_SECONDS


def _request_headers() -> dict[str, str]:
    headers = {"content-type": "application/json"}
    service_token = os.getenv("GATEWAY_SERVICE_TOKEN")
    if service_token:
        headers["authorization"] = f"Bearer {service_token}"
    return headers


def _safe_response_payload(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        text = response.text.strip()
        return {"text": text[:2000]} if text else {}

    return payload if isinstance(payload, dict) else {"data": payload}


def _extract_provider_message_id(response_payload: dict[str, Any]) -> str | None:
    for key in ("provider_message_id", "message_id", "id"):
        value = response_payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _is_transient_status_code(status_code: int) -> bool:
    return status_code in TRANSIENT_HTTP_STATUS_CODES


def _current_retry_delay_seconds() -> int | None:
    current_job = get_current_job()
    if current_job is None or not current_job.should_retry:
        return None
    return current_job.get_retry_interval()


def _has_retry_available() -> bool:
    current_job = get_current_job()
    return bool(current_job is not None and current_job.should_retry)


def send_outbound_to_gateway(payload: dict[str, Any]) -> httpx.Response:
    return httpx.post(
        f"{_gateway_base_url()}/gateway/outbound",
        json=payload,
        headers=_request_headers(),
        timeout=_gateway_timeout_seconds(),
    )


def dispatch_outbound_intent_job(outbound_intent_id: str) -> None:
    db = get_db_session()
    intent_uuid: UUID | None = None

    try:
        intent_uuid = UUID(outbound_intent_id)
    except ValueError:
        logger.error(
            "outbound_dispatch_invalid_intent_id",
            extra={"outbound_intent_id": outbound_intent_id},
        )
        db.close()
        return

    trace_id: str | None = None

    try:
        outbound_intent = get_outbound_intent(db, intent_uuid)
        if outbound_intent is None:
            logger.warning(
                "outbound_intent_not_found",
                extra={"outbound_intent_id": outbound_intent_id},
            )
            return

        # Extract trace_id from stored payload so all subsequent logs carry it.
        trace_id = str(outbound_intent.payload.get("trace_id", "")) or None if outbound_intent.payload else None

        if outbound_intent.status == OutboundStatus.SENT:
            logger.info(
                "outbound_intent_already_sent",
                extra={
                    "trace_id": trace_id,
                    "outbound_intent_id": outbound_intent_id,
                    "status": outbound_intent.status.value,
                },
            )
            return

        outbound_intent = mark_outbound_intent_sending(db, intent_uuid)
        if outbound_intent is None:
            logger.warning(
                "outbound_intent_not_found_after_mark_sending",
                extra={"trace_id": trace_id, "outbound_intent_id": outbound_intent_id},
            )
            return

        payload = dict(outbound_intent.payload or {})
        response = send_outbound_to_gateway(payload)
        response_payload = _safe_response_payload(response)
        response.raise_for_status()

        provider_message_id = _extract_provider_message_id(response_payload)
        mark_outbound_intent_sent(
            db,
            intent_uuid,
            provider_message_id=provider_message_id,
            response_payload=response_payload,
        )
        logger.info(
            "outbound_intent_dispatched",
            extra={
                "trace_id": trace_id,
                "outbound_intent_id": outbound_intent_id,
                "provider_group_id": outbound_intent.provider_group_id,
                "status_code": response.status_code,
                "provider_message_id": provider_message_id,
            },
        )
    except httpx.HTTPStatusError as exc:
        response_payload = _safe_response_payload(exc.response)
        provider_message_id = _extract_provider_message_id(response_payload)
        error_code = f"gateway_http_{exc.response.status_code}"
        error_message = str(exc)
        is_transient = _is_transient_status_code(exc.response.status_code)

        if is_transient and _has_retry_available():
            mark_outbound_intent_retrying(
                db,
                intent_uuid,
                error_code=error_code,
                error_message=error_message,
                provider_message_id=provider_message_id,
                response_payload=response_payload,
                retry_in_seconds=_current_retry_delay_seconds(),
            )
            logger.warning(
                "outbound_dispatch_retrying",
                extra={
                    "trace_id": trace_id,
                    "outbound_intent_id": outbound_intent_id,
                    "status_code": exc.response.status_code,
                    "retry_in_seconds": _current_retry_delay_seconds(),
                },
            )
            raise OutboundDispatchRetryableError(
                f"gateway transient error for outbound intent {outbound_intent_id}"
            ) from exc

        mark_outbound_intent_failed(
            db,
            intent_uuid,
            error_code=error_code,
            error_message=error_message,
            provider_message_id=provider_message_id,
            response_payload=response_payload,
        )
        logger.warning(
            "outbound_dispatch_rejected",
            extra={
                "trace_id": trace_id,
                "outbound_intent_id": outbound_intent_id,
                "status_code": exc.response.status_code,
                "transient": is_transient,
                "retries_remaining": _has_retry_available(),
            },
        )
        if is_transient:
            raise OutboundDispatchError(
                f"gateway retries exhausted for outbound intent {outbound_intent_id}"
            ) from exc
    except httpx.HTTPError as exc:
        if _has_retry_available():
            mark_outbound_intent_retrying(
                db,
                intent_uuid,
                error_code="gateway_transport_error",
                error_message=str(exc),
                retry_in_seconds=_current_retry_delay_seconds(),
            )
            logger.warning(
                "outbound_dispatch_transport_retrying",
                extra={
                    "trace_id": trace_id,
                    "outbound_intent_id": outbound_intent_id,
                    "retry_in_seconds": _current_retry_delay_seconds(),
                },
            )
            raise OutboundDispatchRetryableError(
                f"gateway transport failed for outbound intent {outbound_intent_id}"
            ) from exc

        mark_outbound_intent_failed(
            db,
            intent_uuid,
            error_code="gateway_transport_error",
            error_message=str(exc),
        )
        logger.exception(
            "outbound_dispatch_transport_failed",
            extra={"trace_id": trace_id, "outbound_intent_id": outbound_intent_id},
        )
        raise OutboundDispatchError(
            f"gateway transport failed for outbound intent {outbound_intent_id}"
        ) from exc
    except Exception as exc:
        db.rollback()
        try:
            mark_outbound_intent_failed(
                db,
                intent_uuid,
                error_code="outbound_dispatch_exception",
                error_message=str(exc),
            )
        except Exception:
            db.rollback()

        logger.exception(
            "outbound_dispatch_failed",
            extra={"trace_id": trace_id, "outbound_intent_id": outbound_intent_id},
        )
        raise
    finally:
        db.close()


process_outbound_dispatch_job = dispatch_outbound_intent_job
