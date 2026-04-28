from __future__ import annotations

import logging
import os
import re
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable
from uuid import UUID, uuid4

import httpx
from sqlalchemy import func, select

from kuuna_backend.db.models import (
    AgentInstance,
    AgentRun,
    AgentRunStatus,
    BindingStatus,
    GroupBinding,
    MediaAsset,
    Message,
    MessageDecision,
    MessageLink,
    MessageVersion,
    RuntimeStatus,
    TemplateVersion,
    Transcript,
    Todo,
    TodoPriority,
    TodoStatus,
    ToolInvocationRecord,
)
from kuuna_backend.domain.outbound.service import create_outbound_intent, mark_outbound_intent_failed
from kuuna_backend.domain.retrieval import (
    RetrievalHit,
    knowledge_policy_from_tools_config,
    retrieve_context,
)
from kuuna_backend.integrations.openai import (
    OpenAIIntegrationError,
    create_chat_completion,
    is_openai_configured,
)
from kuuna_backend.integrations.postgres import get_db_session
from kuuna_backend.jobs.queue import enqueue_outbound_dispatch

logger = logging.getLogger(__name__)

_INBOUND_CONFIRMATION_TEXT = "Danke, wir haben deine Nachricht erhalten."
_DEFAULT_SYSTEM_PROMPT = (
    "Du bist ein hilfreicher Support-Agent für eine WhatsApp-Gruppe. "
    "Antworte präzise, freundlich und mit klaren nächsten Schritten."
)
_PASSIVE_ANALYSIS_SYSTEM_PROMPT = (
    "You are an intake triage agent for a WhatsApp support group. "
    "Do not write a reply to the WhatsApp user. Decide whether the latest message, "
    "attached media transcripts, links, and recent context require staff follow-up. "
    "If staff action is needed, call todo_create with a concise title, useful description, "
    "and priority. Use todo_list to avoid duplicates. Return a compact JSON decision summary."
)
_DEFAULT_MODEL = "gpt-5.5"
_DEFAULT_REASONING_EFFORT = "medium"
_DEFAULT_RUNTIME_AGENT_TIMEOUT_SECONDS = 12.0
_PROVIDER_TOKENS = {"openai", "anthropic", "google", "azure-openai"}
_TOOL_COMMAND_PATTERN = re.compile(r"^\s*/tool\s+([a-zA-Z0-9_-]+)(?:\s+(.*))?$")

ToolHandler = Callable[[str], str]


@dataclass(slots=True)
class AgentReply:
    text: str
    model_path: list[str]
    retrieval_refs: list[dict[str, object]]
    allowed_tools: list[str]
    agent_run_id: str | None = None


@dataclass(slots=True)
class RuntimeAgentRunResult:
    text: str
    model_path: list[str]
    agent_run_id: str


def _tool_echo(value: str) -> str:
    return value or "(leer)"


def _tool_uppercase(value: str) -> str:
    return value.upper()


LOCAL_TOOL_HANDLERS: dict[str, ToolHandler] = {
    "echo": _tool_echo,
    "uppercase": _tool_uppercase,
}

PASSIVE_ANALYSIS_TOOLS = {
    "knowledge_search",
    "message_history",
    "todo_create",
    "todo_update",
    "todo_list",
}


def process_inbound_message_job(
    message_id: str,
    provider_group_id: str,
    reason: str | None = None,
    trace_id: str | None = None,
) -> None:
    db = get_db_session()
    message_uuid: UUID | None = None

    try:
        try:
            message_uuid = UUID(message_id)
        except ValueError:
            logger.error(
                "inbound_execution_invalid_message_id",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "reason": reason,
                },
            )
            return

        message = db.execute(
            select(Message)
            .where(
                Message.id == message_uuid,
                Message.provider_group_id == provider_group_id,
            )
            .limit(1)
        ).scalar_one_or_none()
        if message is None:
            logger.warning(
                "inbound_execution_message_not_found",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "reason": reason,
                },
            )
            return

        binding_row = db.execute(
            select(GroupBinding, AgentInstance, TemplateVersion)
            .join(TemplateVersion, TemplateVersion.id == GroupBinding.template_version_id)
            .outerjoin(AgentInstance, AgentInstance.group_binding_id == GroupBinding.id)
            .where(
                GroupBinding.provider_group_id == provider_group_id,
                GroupBinding.status == BindingStatus.ACTIVE,
            )
            .limit(1)
        ).one_or_none()
        if binding_row is None:
            logger.info(
                "inbound_execution_skipped_unbound_group",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "reason": reason,
                },
            )
            return

        binding, agent_instance, template_version = binding_row
        if agent_instance is None:
            logger.error(
                "inbound_execution_missing_agent_instance",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "binding_id": str(binding.id),
                    "reason": reason,
                },
            )
            return

        if agent_instance.status == RuntimeStatus.STOPPED:
            logger.warning(
                "inbound_execution_agent_stopped",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "binding_id": str(binding.id),
                    "agent_instance_id": str(agent_instance.id),
                    "reason": reason,
                },
            )
            return

        latest_message_version = db.execute(
            select(MessageVersion)
            .where(
                MessageVersion.message_id == message.id,
                MessageVersion.version_no == message.latest_version_no,
            )
            .limit(1)
        ).scalar_one_or_none()
        user_text = _extract_user_text(latest_message_version)

        agent_reply = _generate_agent_reply(
            db=db,
            message=message,
            provider_group_id=provider_group_id,
            user_text=user_text,
            template_version=template_version,
            agent_instance=agent_instance,
            trace_id=trace_id,
        )

        outbound_intent = create_outbound_intent(
            db,
            provider_group_id=provider_group_id,
            payload={
                "trace_id": trace_id or str(uuid4()),
                "provider_group_id": provider_group_id,
                "reply_to_provider_message_id": message.provider_message_id,
                "text": agent_reply.text,
                "metadata": {
                    "agent_instance_id": agent_instance.id,
                    "agent_run_id": agent_reply.agent_run_id,
                    "model_path": agent_reply.model_path,
                    "retrieval_refs": agent_reply.retrieval_refs,
                    "allowed_tools": agent_reply.allowed_tools,
                },
            },
        )

        try:
            enqueue_outbound_dispatch(str(outbound_intent.outbound_intent_id))
        except Exception as exc:
            mark_outbound_intent_failed(
                db,
                outbound_intent.outbound_intent_id,
                error_code="inbound_execution_dispatch_enqueue_failed",
                error_message=str(exc),
            )
            logger.exception(
                "inbound_execution_dispatch_enqueue_failed",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "binding_id": str(binding.id),
                    "agent_instance_id": str(agent_instance.id),
                    "outbound_intent_id": str(outbound_intent.outbound_intent_id),
                    "reason": reason,
                },
            )
            return

        logger.info(
            "inbound_execution_outbound_intent_enqueued",
            extra={
                "trace_id": trace_id,
                "message_id": message_id,
                "provider_group_id": provider_group_id,
                "binding_id": str(binding.id),
                "agent_instance_id": str(agent_instance.id),
                "outbound_intent_id": str(outbound_intent.outbound_intent_id),
                "model_path": agent_reply.model_path,
                "retrieval_refs_count": len(agent_reply.retrieval_refs),
                "reason": reason,
            },
        )
    except Exception:
        db.rollback()
        logger.exception(
            "inbound_execution_failed",
            extra={
                "trace_id": trace_id,
                "message_id": message_id,
                "provider_group_id": provider_group_id,
                "reason": reason,
            },
        )
        raise
    finally:
        db.close()


def process_passive_message_analysis_job(
    message_id: str,
    provider_group_id: str,
    reason: str | None = None,
    trace_id: str | None = None,
) -> None:
    db = get_db_session()
    message_uuid: UUID | None = None

    try:
        try:
            message_uuid = UUID(message_id)
        except ValueError:
            logger.error(
                "passive_analysis_invalid_message_id",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "reason": reason,
                },
            )
            return

        message = db.execute(
            select(Message)
            .where(
                Message.id == message_uuid,
                Message.provider_group_id == provider_group_id,
            )
            .limit(1)
        ).scalar_one_or_none()
        if message is None:
            logger.warning(
                "passive_analysis_message_not_found",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "reason": reason,
                },
            )
            return

        binding_row = db.execute(
            select(GroupBinding, AgentInstance, TemplateVersion)
            .join(TemplateVersion, TemplateVersion.id == GroupBinding.template_version_id)
            .outerjoin(AgentInstance, AgentInstance.group_binding_id == GroupBinding.id)
            .where(
                GroupBinding.provider_group_id == provider_group_id,
                GroupBinding.status == BindingStatus.ACTIVE,
            )
            .limit(1)
        ).one_or_none()
        if binding_row is None:
            logger.info(
                "passive_analysis_skipped_unbound_group",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "reason": reason,
                },
            )
            return

        _, agent_instance, template_version = binding_row
        if agent_instance is None or agent_instance.status == RuntimeStatus.STOPPED:
            logger.info(
                "passive_analysis_skipped_inactive_agent",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "reason": reason,
                },
            )
            return

        latest_message_version = db.execute(
            select(MessageVersion)
            .where(
                MessageVersion.message_id == message.id,
                MessageVersion.version_no == message.latest_version_no,
            )
            .limit(1)
        ).scalar_one_or_none()
        if latest_message_version is None or latest_message_version.is_deleted:
            logger.info(
                "passive_analysis_skipped_deleted_or_missing_version",
                extra={
                    "trace_id": trace_id,
                    "message_id": message_id,
                    "provider_group_id": provider_group_id,
                    "reason": reason,
                },
            )
            return

        intake_text = _build_passive_analysis_user_prompt(
            db,
            message=message,
            latest_message_version=latest_message_version,
            reason=reason,
        )
        query_text = _build_passive_analysis_query_text(
            db,
            message=message,
            latest_message_version=latest_message_version,
        )

        retrieval_hits: list[RetrievalHit] = []
        if query_text:
            retrieval_hits = retrieve_context(
                db,
                provider_group_id=provider_group_id,
                query=query_text,
                limit=8,
                knowledge_policy=knowledge_policy_from_tools_config(template_version.tools_config),
            )
        retrieval_refs = _build_retrieval_refs(retrieval_hits)

        allowed_tools = _extract_passive_analysis_tools(template_version.tools_config)
        result = _run_via_runtime_agent(
            db=db,
            message=message,
            trace_id=trace_id,
            provider_group_id=provider_group_id,
            system_prompt=_PASSIVE_ANALYSIS_SYSTEM_PROMPT,
            user_prompt=intake_text,
            model_path=_extract_model_candidates(template_version.model_config),
            reasoning_effort=_extract_reasoning_effort(template_version.model_config),
            allowed_tools=allowed_tools,
            retrieval_refs=retrieval_refs,
            retrieval_hits=retrieval_hits,
            runtime_base_url=agent_instance.runtime_base_url,
        )

        payload: dict[str, object] = {
            "trace_id": trace_id,
            "provider_message_id": message.provider_message_id,
            "reason": reason,
            "allowed_tools": allowed_tools,
            "retrieval_refs": retrieval_refs,
        }
        decision_type = "passive_analysis_failed"
        if result is not None:
            created_todo_count = db.scalar(
                select(func.count())
                .select_from(Todo)
                .where(Todo.agent_run_id == UUID(result.agent_run_id))
            )
            payload.update(
                {
                    "agent_run_id": result.agent_run_id,
                    "model_path": result.model_path,
                    "created_todo_count": int(created_todo_count or 0),
                }
            )
            decision_type = "passive_analysis"

        db.add(
            MessageDecision(
                message_id=message.id,
                provider_group_id=provider_group_id,
                decision_type=decision_type,
                reason=reason or "passive_analysis",
                should_execute=False,
                payload=payload,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "passive_analysis_failed",
            extra={
                "trace_id": trace_id,
                "message_id": message_id,
                "message_uuid": str(message_uuid) if message_uuid else None,
                "provider_group_id": provider_group_id,
                "reason": reason,
            },
        )
        raise
    finally:
        db.close()


def _extract_user_text(latest_message_version: MessageVersion | None) -> str:
    if latest_message_version is None or latest_message_version.is_deleted:
        return ""
    return (latest_message_version.text_content or "").strip()


def _generate_agent_reply(
    *,
    db,
    message: Message,
    provider_group_id: str,
    user_text: str,
    template_version: TemplateVersion,
    agent_instance: AgentInstance,
    trace_id: str | None,
) -> AgentReply:
    allowed_tools = _extract_allowed_tools(template_version.tools_config)
    model_candidates = _extract_model_candidates(template_version.model_config)
    reasoning_effort = _extract_reasoning_effort(template_version.model_config)

    retrieval_hits: list[RetrievalHit] = []
    if user_text:
        retrieval_hits = retrieve_context(
            db,
            provider_group_id=provider_group_id,
            query=user_text,
            limit=8,
            knowledge_policy=knowledge_policy_from_tools_config(template_version.tools_config),
        )
    retrieval_refs = _build_retrieval_refs(retrieval_hits)

    tool_reply = _maybe_execute_tool_command(user_text=user_text, allowed_tools=allowed_tools)
    if tool_reply is not None:
        return AgentReply(
            text=tool_reply,
            model_path=[],
            retrieval_refs=retrieval_refs,
            allowed_tools=allowed_tools,
        )

    if not user_text:
        return AgentReply(
            text=_INBOUND_CONFIRMATION_TEXT,
            model_path=model_candidates[:1],
            retrieval_refs=retrieval_refs,
            allowed_tools=allowed_tools,
        )

    assembled_system_prompt = _build_system_prompt(
        template_system_prompt=template_version.system_prompt,
        allowed_tools=allowed_tools,
    )
    assembled_user_prompt = _build_user_prompt(user_text=user_text, retrieval_hits=retrieval_hits)

    runtime_result = _run_via_runtime_agent(
        db=db,
        message=message,
        trace_id=trace_id,
        provider_group_id=provider_group_id,
        system_prompt=assembled_system_prompt,
        user_prompt=assembled_user_prompt,
        model_path=model_candidates,
        reasoning_effort=reasoning_effort,
        allowed_tools=allowed_tools,
        retrieval_refs=retrieval_refs,
        retrieval_hits=retrieval_hits,
        runtime_base_url=agent_instance.runtime_base_url,
    )
    if runtime_result is not None:
        return AgentReply(
            text=runtime_result.text,
            model_path=runtime_result.model_path,
            retrieval_refs=retrieval_refs,
            allowed_tools=allowed_tools,
            agent_run_id=runtime_result.agent_run_id,
        )

    if is_openai_configured():
        attempted_models: list[str] = []
        for model_name in model_candidates:
            attempted_models.append(model_name)
            try:
                response_text = create_chat_completion(
                    model=model_name,
                    system_prompt=assembled_system_prompt,
                    user_prompt=assembled_user_prompt,
                )
                if response_text.strip():
                    return AgentReply(
                        text=response_text.strip(),
                        model_path=attempted_models,
                        retrieval_refs=retrieval_refs,
                        allowed_tools=allowed_tools,
                    )
            except OpenAIIntegrationError as exc:
                logger.warning(
                    "inbound_execution_model_failed",
                    extra={
                        "trace_id": trace_id,
                        "provider_group_id": provider_group_id,
                        "model": model_name,
                        "error": str(exc),
                    },
                )

    return AgentReply(
        text=_build_fallback_reply(user_text=user_text, retrieval_hits=retrieval_hits),
        model_path=model_candidates[:1],
        retrieval_refs=retrieval_refs,
        allowed_tools=allowed_tools,
    )


def _extract_allowed_tools(tools_config: object) -> list[str]:
    if not isinstance(tools_config, dict):
        return []

    candidates: list[str] = []

    for key in ("allowed_tools", "allowedTools"):
        raw = tools_config.get(key)
        if isinstance(raw, list):
            candidates.extend(item for item in raw if isinstance(item, str))

    raw_tools = tools_config.get("tools")
    if isinstance(raw_tools, list):
        for item in raw_tools:
            if isinstance(item, str):
                candidates.append(item)
            elif isinstance(item, dict):
                name = item.get("name")
                enabled = item.get("enabled", True)
                if isinstance(name, str) and name and enabled is not False:
                    candidates.append(name)

    normalized: list[str] = []
    for candidate in candidates:
        value = candidate.strip().lower()
        if value and value not in normalized:
            normalized.append(value)
    return normalized


def _extract_passive_analysis_tools(tools_config: object) -> list[str]:
    configured_tools = _extract_allowed_tools(tools_config)
    if not configured_tools:
        return [
            "knowledge_search",
            "message_history",
            "todo_create",
            "todo_update",
            "todo_list",
        ]

    return [tool for tool in configured_tools if tool in PASSIVE_ANALYSIS_TOOLS]


def _extract_model_candidates(model_config: object) -> list[str]:
    if not isinstance(model_config, dict):
        return [_DEFAULT_MODEL]

    raw_candidates: list[str] = []

    for key in (
        "failover_chain",
        "failoverChain",
        "model_chain",
        "modelChain",
        "models",
        "model_path",
    ):
        value = model_config.get(key)
        if isinstance(value, list):
            raw_candidates.extend(item for item in value if isinstance(item, str))

    for key in ("model", "model_name", "modelName", "model_id", "modelId"):
        value = model_config.get(key)
        if isinstance(value, str):
            raw_candidates.append(value)

    nested_model = model_config.get("model")
    if isinstance(nested_model, dict):
        provider = nested_model.get("provider")
        model_name = nested_model.get("model_name") or nested_model.get("model")
        if isinstance(provider, str) and isinstance(model_name, str):
            raw_candidates.append(f"{provider}/{model_name}")

    normalized: list[str] = []
    for candidate in raw_candidates:
        normalized_candidate = _normalize_model_candidate(candidate)
        if normalized_candidate and normalized_candidate not in normalized:
            normalized.append(normalized_candidate)

    return normalized or [_DEFAULT_MODEL]


def _extract_reasoning_effort(model_config: object) -> str:
    if not isinstance(model_config, dict):
        return _DEFAULT_REASONING_EFFORT

    for key in ("reasoning_effort", "reasoningEffort", "thinking_level", "thinkingLevel"):
        value = model_config.get(key)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"none", "minimal", "low", "medium", "high", "xhigh"}:
                return normalized

    nested_model = model_config.get("model")
    if isinstance(nested_model, dict):
        value = nested_model.get("reasoning_effort") or nested_model.get("reasoningEffort")
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"none", "minimal", "low", "medium", "high", "xhigh"}:
                return normalized

    return _DEFAULT_REASONING_EFFORT


def _normalize_model_candidate(candidate: str) -> str:
    normalized = candidate.strip()
    if not normalized:
        return ""

    lowered = normalized.lower()
    if lowered in _PROVIDER_TOKENS:
        return ""

    if "/" in normalized:
        provider, model_name = normalized.split("/", 1)
        if provider.strip().lower() in _PROVIDER_TOKENS:
            return model_name.strip()

    return normalized


def _build_system_prompt(*, template_system_prompt: str | None, allowed_tools: list[str]) -> str:
    base_prompt = (template_system_prompt or _DEFAULT_SYSTEM_PROMPT).strip()
    if not allowed_tools:
        return base_prompt

    tools_block = ", ".join(allowed_tools)
    return f"{base_prompt}\n\nAktivierte Tools für diese Gruppe: {tools_block}."


def _build_user_prompt(*, user_text: str, retrieval_hits: list[RetrievalHit]) -> str:
    if not retrieval_hits:
        return user_text

    context_lines = ["Kontext aus Chat/Knowledge:"]
    for hit in retrieval_hits[:6]:
        scope = hit.source_scope
        snippet = hit.content.strip().replace("\n", " ")
        if len(snippet) > 220:
            snippet = f"{snippet[:220]}…"
        context_lines.append(f"- [{scope}] {snippet}")

    context_block = "\n".join(context_lines)
    return f"Nutzeranfrage:\n{user_text}\n\n{context_block}"


def _build_passive_analysis_query_text(
    db,
    *,
    message: Message,
    latest_message_version: MessageVersion,
) -> str:
    parts = [(latest_message_version.text_content or "").strip()]
    parts.extend(_message_link_texts(db, message_id=message.id))
    parts.extend(_media_transcript_texts(db, message_id=message.id))
    return "\n\n".join(part for part in parts if part).strip()


def _build_passive_analysis_user_prompt(
    db,
    *,
    message: Message,
    latest_message_version: MessageVersion,
    reason: str | None,
) -> str:
    lines = [
        f"provider_group_id: {message.provider_group_id}",
        f"provider_message_id: {message.provider_message_id}",
        f"sender_provider_user_id: {message.sender_provider_user_id or ''}",
        f"occurred_at: {latest_message_version.occurred_at.isoformat()}",
        f"analysis_reason: {reason or 'message_received'}",
        "",
        "latest_message_text:",
        (latest_message_version.text_content or "").strip() or "(no text)",
    ]

    links = _message_link_texts(db, message_id=message.id)
    if links:
        lines.extend(["", "links:", *[f"- {link}" for link in links]])

    transcript_texts = _media_transcript_texts(db, message_id=message.id)
    if transcript_texts:
        lines.extend(["", "media_transcripts:", *[f"- {text}" for text in transcript_texts]])

    lines.extend(
        [
            "",
            "Decision policy:",
            "- Create a todo for concrete staff work, deadlines, evidence review, missing documents, legal/accounting questions, or client follow-up.",
            "- Do not create todos for greetings, acknowledgements, jokes, duplicates, or messages with no actionable content.",
            "- Keep todo titles short and include enough description for a dashboard user to act without reopening the whole chat.",
        ]
    )
    return "\n".join(lines)


def _message_link_texts(db, *, message_id: UUID) -> list[str]:
    rows = db.scalars(
        select(MessageLink)
        .where(MessageLink.message_id == message_id)
        .order_by(MessageLink.created_at.asc())
    ).all()
    texts: list[str] = []
    for link in rows:
        title = (link.title or "").strip()
        url = link.normalized_url or link.url
        text = f"{title} {url}".strip() if title else url
        if text:
            texts.append(text)
    return texts


def _media_transcript_texts(db, *, message_id: UUID) -> list[str]:
    rows = db.execute(
        select(MediaAsset, Transcript)
        .outerjoin(Transcript, Transcript.media_asset_id == MediaAsset.id)
        .where(MediaAsset.message_id == message_id)
        .order_by(MediaAsset.created_at.asc())
    ).all()
    texts: list[str] = []
    for asset, transcript in rows:
        transcript_text = (transcript.text_content or "").strip() if transcript is not None else ""
        if not transcript_text or transcript_text.startswith("Transcript pending"):
            continue
        label = asset.file_name or asset.mime_type
        texts.append(f"{label}: {transcript_text}")
    return texts


def _runtime_agent_base_url(runtime_base_url: str | None = None) -> str:
    if runtime_base_url and runtime_base_url.strip():
        return runtime_base_url.strip().rstrip("/")
    raise RuntimeError("runtime_base_url is required; shared runtime fallback has been removed")


def _runtime_agent_timeout_seconds() -> float:
    raw_value = os.getenv("RUNTIME_AGENT_TIMEOUT_SECONDS")
    if not raw_value:
        return _DEFAULT_RUNTIME_AGENT_TIMEOUT_SECONDS

    try:
        return float(raw_value)
    except ValueError:
        return _DEFAULT_RUNTIME_AGENT_TIMEOUT_SECONDS


def _run_via_runtime_agent(
    *,
    db,
    message: Message,
    trace_id: str | None,
    provider_group_id: str,
    system_prompt: str,
    user_prompt: str,
    model_path: list[str],
    reasoning_effort: str,
    allowed_tools: list[str],
    retrieval_refs: list[dict[str, object]],
    retrieval_hits: list[RetrievalHit],
    runtime_base_url: str | None = None,
) -> RuntimeAgentRunResult | None:
    agent_run = AgentRun(
        message_id=message.id,
        provider_group_id=provider_group_id,
        trace_id=trace_id,
        status=AgentRunStatus.RUNNING,
        model_path=model_path,
        reasoning_effort=reasoning_effort,
        allowed_tools=allowed_tools,
        retrieval_refs=retrieval_refs,
    )
    db.add(agent_run)
    db.commit()
    db.refresh(agent_run)

    payload = {
        "trace_id": trace_id,
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
        "context": {
            "provider_group_id": provider_group_id,
            "retrieval_refs": retrieval_refs,
            "retrieval_hits": _build_runtime_retrieval_hits(retrieval_hits),
            "recent_messages": _build_recent_messages_context(db, provider_group_id=provider_group_id),
            "todos": _build_todos_context(db, provider_group_id=provider_group_id),
        },
        "model_path": model_path,
        "reasoning_effort": reasoning_effort,
        "allowed_tools": allowed_tools,
        "tool_requests": [],
    }

    try:
        response = httpx.post(
            f"{_runtime_agent_base_url(runtime_base_url)}/run",
            json=payload,
            timeout=_runtime_agent_timeout_seconds(),
        )
        response.raise_for_status()
    except Exception as exc:
        _complete_agent_run(
            db,
            agent_run=agent_run,
            status=AgentRunStatus.FAILED,
            error=str(exc),
        )
        logger.warning(
            "runtime_agent_request_failed",
            extra={
                "trace_id": trace_id,
                "provider_group_id": provider_group_id,
                "error": str(exc),
            },
        )
        return None

    try:
        result_payload = response.json()
    except ValueError as exc:
        _complete_agent_run(
            db,
            agent_run=agent_run,
            status=AgentRunStatus.FAILED,
            error=f"runtime-agent returned invalid JSON: {exc}",
        )
        logger.warning(
            "runtime_agent_invalid_json",
            extra={
                "trace_id": trace_id,
                "provider_group_id": provider_group_id,
                "error": str(exc),
            },
        )
        return None

    if not isinstance(result_payload, dict):
        _complete_agent_run(
            db,
            agent_run=agent_run,
            status=AgentRunStatus.FAILED,
            error="runtime-agent returned non-object JSON payload",
        )
        logger.warning(
            "runtime_agent_invalid_payload",
            extra={
                "trace_id": trace_id,
                "provider_group_id": provider_group_id,
                "payload_type": type(result_payload).__name__,
            },
        )
        return None

    if not bool(result_payload.get("success")):
        _complete_agent_run(
            db,
            agent_run=agent_run,
            status=AgentRunStatus.FAILED,
            error=str(result_payload.get("error") or "runtime-agent returned unsuccessful result"),
        )
        logger.warning(
            "runtime_agent_execution_unsuccessful",
            extra={
                "trace_id": trace_id,
                "provider_group_id": provider_group_id,
                "error": str(result_payload.get("error")),
            },
        )
        return None

    response_text = str(result_payload.get("response_text") or "").strip()
    if not response_text:
        _complete_agent_run(
            db,
            agent_run=agent_run,
            status=AgentRunStatus.FAILED,
            error="runtime-agent returned empty response",
        )
        return None

    attempts = result_payload.get("attempts")
    attempt_models: list[str] = []
    if isinstance(attempts, list):
        for attempt in attempts:
            if isinstance(attempt, dict):
                model_name = attempt.get("model")
                if isinstance(model_name, str) and model_name and model_name not in attempt_models:
                    attempt_models.append(model_name)

    if not attempt_models:
        model_used = result_payload.get("model_used")
        if isinstance(model_used, str) and model_used:
            attempt_models = [model_used]

    model_used = result_payload.get("model_used")
    _complete_agent_run(
        db,
        agent_run=agent_run,
        status=AgentRunStatus.SUCCEEDED,
        model_used=model_used if isinstance(model_used, str) else None,
        model_path=attempt_models or model_path[:1],
        response_text=response_text,
    )
    _persist_runtime_tool_results(
        db,
        agent_run=agent_run,
        message=message,
        provider_group_id=provider_group_id,
        tool_results=result_payload.get("tool_results"),
    )
    db.commit()

    return RuntimeAgentRunResult(
        text=response_text,
        model_path=attempt_models or model_path[:1],
        agent_run_id=str(agent_run.id),
    )


def _build_retrieval_refs(retrieval_hits: list[RetrievalHit]) -> list[dict[str, object]]:
    refs: list[dict[str, object]] = []
    for hit in retrieval_hits:
        ref: dict[str, object] = {
            "source_type": hit.source_type,
            "source_scope": hit.source_scope,
            "score": round(hit.score, 4),
        }

        if hit.provider_message_id is not None:
            ref["provider_message_id"] = hit.provider_message_id
        if hit.message_id is not None:
            ref["message_id"] = str(hit.message_id)
        if hit.message_version_id is not None:
            ref["message_version_id"] = str(hit.message_version_id)
        if hit.knowledge_version_id is not None:
            ref["knowledge_version_id"] = str(hit.knowledge_version_id)
        if hit.knowledge_doc_id is not None:
            ref["knowledge_doc_id"] = str(hit.knowledge_doc_id)
        if hit.knowledge_doc_title is not None:
            ref["knowledge_doc_title"] = hit.knowledge_doc_title
        if hit.chunk_no is not None:
            ref["chunk_no"] = hit.chunk_no

        refs.append(ref)

    return refs


def _build_runtime_retrieval_hits(retrieval_hits: list[RetrievalHit]) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for hit in retrieval_hits:
        item: dict[str, object] = {
            "source_type": hit.source_type,
            "source_scope": hit.source_scope,
            "score": round(hit.score, 4),
            "content": hit.content,
            "occurred_at": hit.occurred_at.isoformat(),
        }
        if hit.provider_message_id:
            item["provider_message_id"] = hit.provider_message_id
        if hit.knowledge_doc_title:
            item["knowledge_doc_title"] = hit.knowledge_doc_title
        items.append(item)
    return items


def _build_recent_messages_context(db, *, provider_group_id: str, limit: int = 15) -> list[dict[str, object]]:
    rows = db.execute(
        select(Message, MessageVersion)
        .join(
            MessageVersion,
            (MessageVersion.message_id == Message.id)
            & (MessageVersion.version_no == Message.latest_version_no),
        )
        .where(
            Message.provider_group_id == provider_group_id,
            MessageVersion.is_deleted.is_(False),
        )
        .order_by(MessageVersion.occurred_at.desc(), Message.id.desc())
        .limit(limit)
    ).all()

    messages: list[dict[str, object]] = []
    for message, version in rows:
        messages.append(
            {
                "message_id": str(message.id),
                "provider_message_id": message.provider_message_id,
                "sender_provider_user_id": message.sender_provider_user_id,
                "text": version.text_content or "",
                "occurred_at": version.occurred_at.isoformat(),
            }
        )
    return messages


def _build_todos_context(db, *, provider_group_id: str, limit: int = 20) -> list[dict[str, object]]:
    todos = db.scalars(
        select(Todo)
        .where(
            Todo.provider_group_id == provider_group_id,
            Todo.status.in_([TodoStatus.OPEN, TodoStatus.IN_PROGRESS]),
        )
        .order_by(Todo.updated_at.desc())
        .limit(limit)
    ).all()

    return [
        {
            "id": str(todo.id),
            "title": todo.title,
            "description": todo.description or "",
            "status": todo.status.value,
            "priority": todo.priority.value,
            "due_at": todo.due_at.isoformat() if todo.due_at else None,
        }
        for todo in todos
    ]


def _complete_agent_run(
    db,
    *,
    agent_run: AgentRun,
    status: AgentRunStatus,
    model_used: str | None = None,
    model_path: list[str] | None = None,
    response_text: str | None = None,
    error: str | None = None,
) -> None:
    agent_run.status = status
    agent_run.completed_at = datetime.now(timezone.utc)
    if model_used is not None:
        agent_run.model_used = model_used
    if model_path is not None:
        agent_run.model_path = model_path
    if response_text is not None:
        agent_run.response_text = response_text
    if error is not None:
        agent_run.error = error
    db.commit()


def _persist_runtime_tool_results(
    db,
    *,
    agent_run: AgentRun,
    message: Message,
    provider_group_id: str,
    tool_results: object,
) -> None:
    if not isinstance(tool_results, list):
        return

    for raw_result in tool_results:
        if not isinstance(raw_result, dict):
            continue
        tool_name = str(raw_result.get("name") or "").strip().lower()
        if not tool_name:
            continue

        details = _extract_tool_details(raw_result)
        db.add(
            ToolInvocationRecord(
                agent_run_id=agent_run.id,
                message_id=message.id,
                provider_group_id=provider_group_id,
                tool_name=tool_name,
                ok=bool(raw_result.get("ok")),
                stdout=str(raw_result.get("stdout") or ""),
                stderr=str(raw_result.get("stderr") or ""),
                timed_out=bool(raw_result.get("timed_out")),
                duration_ms=_coerce_int(raw_result.get("duration_ms")),
                details=details,
            )
        )

        if bool(raw_result.get("ok")):
            _apply_todo_tool_result(
                db,
                tool_name=tool_name,
                details=details,
                message=message,
                agent_run=agent_run,
                provider_group_id=provider_group_id,
            )


def _extract_tool_details(raw_result: dict[str, object]) -> dict[str, object]:
    details = raw_result.get("details")
    if isinstance(details, dict):
        return dict(details)

    stdout = raw_result.get("stdout")
    if isinstance(stdout, str) and stdout.strip().startswith("{"):
        try:
            decoded = json.loads(stdout)
        except json.JSONDecodeError:
            return {}
        if isinstance(decoded, dict):
            return decoded

    return {}


def _apply_todo_tool_result(
    db,
    *,
    tool_name: str,
    details: dict[str, object],
    message: Message,
    agent_run: AgentRun,
    provider_group_id: str,
) -> None:
    if tool_name == "todo_create":
        title = str(details.get("title") or "").strip()
        if not title:
            return
        existing_todo = db.scalar(
            select(Todo)
            .where(
                Todo.provider_group_id == provider_group_id,
                Todo.message_id == message.id,
                Todo.title == title[:255],
            )
            .limit(1)
        )
        if existing_todo is not None:
            return
        db.add(
            Todo(
                provider_group_id=provider_group_id,
                message_id=message.id,
                agent_run_id=agent_run.id,
                title=title[:255],
                description=_optional_str(details.get("description")),
                priority=_coerce_todo_priority(details.get("priority")),
                due_at=_parse_datetime(details.get("due_at")),
            )
        )
        return

    if tool_name != "todo_update":
        return

    todo_id = details.get("todo_id") or details.get("id")
    if not isinstance(todo_id, str):
        return
    try:
        todo_uuid = UUID(todo_id)
    except ValueError:
        return

    todo = db.scalar(
        select(Todo)
        .where(Todo.id == todo_uuid, Todo.provider_group_id == provider_group_id)
        .limit(1)
    )
    if todo is None:
        return

    title = _optional_str(details.get("title"))
    if title:
        todo.title = title[:255]
    description = _optional_str(details.get("description"))
    if description is not None:
        todo.description = description
    todo.status = _coerce_todo_status(details.get("status"), default=todo.status)
    todo.priority = _coerce_todo_priority(details.get("priority"), default=todo.priority)
    if todo.status == TodoStatus.DONE and todo.completed_at is None:
        todo.completed_at = datetime.now(timezone.utc)


def _coerce_int(value: object) -> int:
    if isinstance(value, int):
        return max(value, 0)
    if isinstance(value, float):
        return max(int(value), 0)
    return 0


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _coerce_todo_priority(
    value: object,
    *,
    default: TodoPriority = TodoPriority.NORMAL,
) -> TodoPriority:
    if isinstance(value, str):
        try:
            return TodoPriority(value.strip().lower())
        except ValueError:
            return default
    return default


def _coerce_todo_status(
    value: object,
    *,
    default: TodoStatus = TodoStatus.OPEN,
) -> TodoStatus:
    if isinstance(value, str):
        try:
            return TodoStatus(value.strip().lower())
        except ValueError:
            return default
    return default


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _maybe_execute_tool_command(*, user_text: str, allowed_tools: list[str]) -> str | None:
    if not user_text:
        return None

    match = _TOOL_COMMAND_PATTERN.match(user_text)
    if not match:
        return None

    tool_name = match.group(1).lower()
    tool_input = (match.group(2) or "").strip()

    if tool_name not in allowed_tools:
        return (
            f"Tool `{tool_name}` ist für diese Gruppe nicht freigeschaltet. "
            "Bitte wende dich an das Team für die Template-Konfiguration."
        )

    handler = LOCAL_TOOL_HANDLERS.get(tool_name)
    if handler is None:
        return f"Tool `{tool_name}` ist konfiguriert, aber aktuell nicht implementiert."

    try:
        output = handler(tool_input)
    except Exception:
        return f"Tool `{tool_name}` konnte nicht ausgeführt werden."

    return f"Tool `{tool_name}` Ergebnis:\n{output}"


def _build_fallback_reply(*, user_text: str, retrieval_hits: list[RetrievalHit]) -> str:
    normalized_text = " ".join(user_text.split())
    if not normalized_text:
        return _INBOUND_CONFIRMATION_TEXT

    if len(normalized_text) > 240:
        normalized_text = f"{normalized_text[:240]}…"

    if retrieval_hits:
        return (
            "Danke für deine Nachricht. "
            f"Ich habe {len(retrieval_hits)} passende Kontexteinträge berücksichtigt.\n\n"
            f"Kurzantwort: {normalized_text}"
        )

    return f"Danke für deine Nachricht. Kurzantwort: {normalized_text}"


process_inbound_execution_job = process_inbound_message_job
