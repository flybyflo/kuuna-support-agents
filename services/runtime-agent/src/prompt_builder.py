from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping

DEFAULT_SYSTEM_PROMPT = (
    "You are a local runtime agent. Use the supplied context and tools carefully."
)


@dataclass(slots=True)
class PromptAssembly:
    system_message: str
    user_message: str
    context_message: str | None
    full_prompt: str


def _serialize_context_value(value: Any) -> str:
    if isinstance(value, str):
        return value

    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def build_prompt(
    system_prompt: str | None,
    user_prompt: str,
    context: Mapping[str, Any] | None = None,
) -> PromptAssembly:
    """Build a deterministic prompt from system, user, and context data."""

    normalized_system = (system_prompt or DEFAULT_SYSTEM_PROMPT).strip()
    normalized_user = user_prompt.strip()
    normalized_context = context or {}

    context_message: str | None = None
    if normalized_context:
        context_lines = ["## Context"]
        for key, value in normalized_context.items():
            context_lines.append(f"- {key}: {_serialize_context_value(value)}")
        context_message = "\n".join(context_lines)

    prompt_parts = [f"## System\n{normalized_system}"]
    if context_message is not None:
        prompt_parts.append(context_message)
    prompt_parts.append(f"## User\n{normalized_user}")

    return PromptAssembly(
        system_message=normalized_system,
        user_message=normalized_user,
        context_message=context_message,
        full_prompt="\n\n".join(prompt_parts),
    )
