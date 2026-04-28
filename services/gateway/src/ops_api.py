from __future__ import annotations

import re
import threading
from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

try:
    from neonize.exc import GetJoinedGroupsError
except Exception:  # pragma: no cover - depends on runtime image
    GetJoinedGroupsError = None

try:
    from neonize.utils.jid import JID, Jid2String, build_jid
except Exception:  # pragma: no cover - depends on runtime image
    JID = None
    Jid2String = None
    build_jid = None


class WhatsAppGroupItem(BaseModel):
    jid: str
    name: str
    participants_count: int = 0


class WhatsAppGroupListResponse(BaseModel):
    items: list[WhatsAppGroupItem]


class WhatsAppGroupCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    participants: list[str] = Field(default_factory=list)


class WhatsAppGroupCreateResponse(BaseModel):
    ok: bool = True
    group: WhatsAppGroupItem


class GatewayOutboundRequest(BaseModel):
    trace_id: str = Field(min_length=1, max_length=120)
    outbound_intent_id: str = Field(min_length=1, max_length=120)
    provider_group_id: str = Field(min_length=1, max_length=255)
    reply_to_provider_message_id: str | None = None
    text: str = Field(min_length=1, max_length=8000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class GatewayOutboundResponse(BaseModel):
    accepted: bool = True
    trace_id: str
    outbound_intent_id: str
    provider_group_id: str
    provider_message_id: str | None = None


class WhatsAppConnectionStatusResponse(BaseModel):
    connected: bool
    last_event: str
    last_changed_at: str
    checked_at: str
    last_error: str | None = None


class WhatsAppQrStatusResponse(BaseModel):
    qr: str | None = None
    updated_at: str


def _group_name(group_info: Any, fallback: str) -> str:
    group_name_obj = getattr(group_info, "GroupName", None)
    maybe_name = getattr(group_name_obj, "Name", None)
    if isinstance(maybe_name, str) and maybe_name.strip():
        return maybe_name.strip()

    topic_obj = getattr(group_info, "GroupTopic", None)
    topic = getattr(topic_obj, "Topic", None)
    if isinstance(topic, str) and topic.strip():
        return topic.strip()

    return fallback


def _group_to_item(group_info: Any) -> WhatsAppGroupItem:
    if Jid2String is None:
        raise RuntimeError("jid conversion is not available")

    jid_obj = getattr(group_info, "JID", None)
    jid = Jid2String(jid_obj) if jid_obj is not None else ""
    jid = jid or "unknown@g.us"
    participants = getattr(group_info, "Participants", None)
    participants_count = len(participants) if participants is not None else 0
    return WhatsAppGroupItem(
        jid=jid,
        name=_group_name(group_info, fallback=jid),
        participants_count=participants_count,
    )


def _parse_participant_jid(value: str) -> Any:
    if JID is None or build_jid is None:
        raise RuntimeError("jid helpers are not available")

    normalized = value.strip()
    if not normalized:
        raise ValueError("participant jid is empty")

    if "@" in normalized:
        user, server = normalized.split("@", 1)
        user = user.strip().lstrip("+")
        server = server.strip()
        if not user or not server:
            raise ValueError(f"invalid participant jid: {value}")
        return JID(User=user, Server=server, Device=0, RawAgent=0, Integrator=0)

    digits = re.sub(r"[^0-9]", "", normalized)
    if not digits:
        raise ValueError(f"invalid participant phone: {value}")
    return build_jid(digits)


def _parse_group_jid(value: str) -> Any:
    if JID is None:
        raise RuntimeError("jid helpers are not available")

    normalized = value.strip()
    if not normalized:
        raise ValueError("group jid is empty")
    if "@" not in normalized:
        raise ValueError("group jid must contain '@'")

    user, server = normalized.split("@", 1)
    user = user.strip()
    server = server.strip()
    if not user or not server:
        raise ValueError("group jid must include user and server")

    return JID(User=user, Server=server, Device=0, RawAgent=0, Integrator=0)


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None

    prefix = "bearer "
    if authorization.lower().startswith(prefix):
        token = authorization[len(prefix) :].strip()
        return token or None

    return None


def _extract_provider_message_id(send_response: Any) -> str | None:
    if send_response is None:
        return None

    for attr in ("ID", "id", "MessageID", "message_id"):
        value = getattr(send_response, attr, None)
        if value is not None:
            text = str(value).strip()
            if text:
                return text

    if isinstance(send_response, dict):
        for key in ("ID", "id", "message_id", "provider_message_id"):
            value = send_response.get(key)
            if value is not None:
                text = str(value).strip()
                if text:
                    return text

    return None


def create_ops_app(
    *,
    client: Any,
    ops_token: str | None,
    service_token: str | None = None,
    connection_status_provider: Callable[[], dict[str, Any]] | None = None,
    qr_status_provider: Callable[[], dict[str, Any]] | None = None,
) -> FastAPI:
    app = FastAPI(title="Kuuna Gateway Ops", version="0.1.0")
    lock = threading.Lock()

    def require_token(token: str | None) -> None:
        if not ops_token:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="gateway ops token not configured",
            )

        if token != ops_token:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="invalid gateway ops token",
            )

    def require_service_token(authorization: str | None) -> None:
        if not service_token:
            return

        token = _extract_bearer_token(authorization)
        if token != service_token:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="invalid gateway service token",
            )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ops/groups", response_model=WhatsAppGroupListResponse)
    def list_groups(
        x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    ) -> WhatsAppGroupListResponse:
        require_token(x_internal_token)

        try:
            with lock:
                groups = client.get_joined_groups()
        except Exception as exc:
            if GetJoinedGroupsError is not None and isinstance(exc, GetJoinedGroupsError):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="WhatsApp group list is temporarily unavailable; retry after the gateway is fully connected.",
                ) from exc
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"failed to list WhatsApp groups: {exc}",
            ) from exc

        items = [_group_to_item(group_info) for group_info in groups]
        items.sort(key=lambda item: (item.name.lower(), item.jid.lower()))
        return WhatsAppGroupListResponse(items=items)

    @app.get("/ops/connection", response_model=WhatsAppConnectionStatusResponse)
    def connection_status(
        x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    ) -> WhatsAppConnectionStatusResponse:
        require_token(x_internal_token)

        if connection_status_provider is not None:
            snapshot = connection_status_provider()
            return WhatsAppConnectionStatusResponse(
                connected=bool(snapshot.get("connected", False)),
                last_event=str(snapshot.get("last_event") or "unknown"),
                last_changed_at=str(snapshot.get("last_changed_at") or ""),
                checked_at=str(snapshot.get("checked_at") or ""),
                last_error=str(snapshot.get("last_error")) if snapshot.get("last_error") is not None else None,
            )

        # Fallback when no explicit status tracker is provided.
        return WhatsAppConnectionStatusResponse(
            connected=bool(getattr(client, "connected", False)),
            last_event="connected" if bool(getattr(client, "connected", False)) else "disconnected",
            last_changed_at="",
            checked_at="",
            last_error=None,
        )

    @app.get("/ops/qr", response_model=WhatsAppQrStatusResponse)
    def qr_status(
        x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    ) -> WhatsAppQrStatusResponse:
        require_token(x_internal_token)

        if qr_status_provider is None:
            return WhatsAppQrStatusResponse(qr=None, updated_at="")

        snapshot = qr_status_provider()
        return WhatsAppQrStatusResponse(
            qr=str(snapshot.get("qr")) if snapshot.get("qr") is not None else None,
            updated_at=str(snapshot.get("updated_at") or ""),
        )

    @app.post("/ops/groups", response_model=WhatsAppGroupCreateResponse)
    def create_group(
        payload: WhatsAppGroupCreateRequest,
        x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    ) -> WhatsAppGroupCreateResponse:
        require_token(x_internal_token)

        try:
            participant_jids = [_parse_participant_jid(item) for item in payload.participants]
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

        with lock:
            group_info = client.create_group(payload.name.strip(), participants=participant_jids)

        return WhatsAppGroupCreateResponse(group=_group_to_item(group_info))

    @app.post("/gateway/outbound", response_model=GatewayOutboundResponse)
    def send_outbound(
        payload: GatewayOutboundRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> GatewayOutboundResponse:
        require_service_token(authorization)

        try:
            target_jid = _parse_group_jid(payload.provider_group_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

        try:
            with lock:
                send_response = client.send_message(target_jid, payload.text)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"outbound send failed: {exc}",
            ) from exc

        return GatewayOutboundResponse(
            accepted=True,
            trace_id=payload.trace_id,
            outbound_intent_id=payload.outbound_intent_id,
            provider_group_id=payload.provider_group_id,
            provider_message_id=_extract_provider_message_id(send_response),
        )

    return app
