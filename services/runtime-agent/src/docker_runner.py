from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from typing import Any

from prompt_builder import PromptAssembly
from result_schema import ModelAttempt, RuntimeAgentResult, RunnerInput

logger = logging.getLogger(__name__)

# Conservative allowlist: image refs are docker image names, digests, or repo paths.
_IMAGE_REF_RE = re.compile(r"^[a-zA-Z0-9._/@:+-]+$")


def is_safe_image_ref(value: str) -> bool:
    stripped = value.strip()
    if not stripped or len(stripped) > 512:
        return False
    return bool(_IMAGE_REF_RE.fullmatch(stripped))


def _docker_bin() -> str:
    return (os.getenv("DOCKER_CLI_PATH", "docker") or "docker").strip() or "docker"


def _docker_timeout_seconds() -> float:
    raw = os.getenv("RUNTIME_AGENT_DOCKER_TIMEOUT_SECONDS", "").strip()
    if not raw:
        return 120.0
    try:
        return float(raw)
    except ValueError:
        return 120.0


def run_template_client_image(*, request: RunnerInput, prompt: PromptAssembly) -> RuntimeAgentResult:
    """Execute the published template image via `docker run` (Issue #3)."""

    image_ref = (request.image_ref or "").strip()
    if not is_safe_image_ref(image_ref):
        return RuntimeAgentResult(
            success=False,
            prompt=prompt.full_prompt,
            system_prompt=prompt.system_message,
            user_prompt=prompt.user_message,
            context_block=prompt.context_message,
            attempts=[],
            error="invalid or unsafe image_ref",
        )

    stdin_payload: dict[str, Any] = {
        "trace_id": request.trace_id,
        "system_prompt": prompt.system_message,
        "user_prompt": prompt.user_message,
        "model_path": list(request.model_path),
        "allowed_tools": list(request.allowed_tools),
        "context": dict(request.context),
    }

    cmd = [
        _docker_bin(),
        "run",
        "--rm",
        "-i",
        image_ref,
    ]

    try:
        completed = subprocess.run(
            cmd,
            input=json.dumps(stdin_payload).encode("utf-8"),
            capture_output=True,
            timeout=_docker_timeout_seconds(),
            check=False,
            env=os.environ.copy(),
        )
    except subprocess.TimeoutExpired:
        logger.warning(
            "runtime_agent_docker_run_timeout",
            extra={"trace_id": request.trace_id, "image_ref": image_ref},
        )
        return RuntimeAgentResult(
            success=False,
            prompt=prompt.full_prompt,
            system_prompt=prompt.system_message,
            user_prompt=prompt.user_message,
            context_block=prompt.context_message,
            attempts=[],
            error="docker run timed out",
        )
    except Exception as exc:  # pragma: no cover - subprocess setup
        logger.exception(
            "runtime_agent_docker_run_failed",
            extra={"trace_id": request.trace_id, "image_ref": image_ref},
        )
        return RuntimeAgentResult(
            success=False,
            prompt=prompt.full_prompt,
            system_prompt=prompt.system_message,
            user_prompt=prompt.user_message,
            context_block=prompt.context_message,
            attempts=[],
            error=f"docker run failed: {exc}",
        )

    if completed.returncode != 0:
        err_tail = (completed.stderr or b"").decode("utf-8", errors="replace")[-4000:]
        logger.warning(
            "runtime_agent_docker_run_nonzero",
            extra={
                "trace_id": request.trace_id,
                "image_ref": image_ref,
                "returncode": completed.returncode,
                "stderr_tail": err_tail,
            },
        )
        return RuntimeAgentResult(
            success=False,
            prompt=prompt.full_prompt,
            system_prompt=prompt.system_message,
            user_prompt=prompt.user_message,
            context_block=prompt.context_message,
            attempts=[],
            error=f"docker exit {completed.returncode}: {err_tail or '(no stderr)'}",
        )

    raw_out = (completed.stdout or b"").decode("utf-8", errors="replace").strip()
    if not raw_out:
        return RuntimeAgentResult(
            success=False,
            prompt=prompt.full_prompt,
            system_prompt=prompt.system_message,
            user_prompt=prompt.user_message,
            context_block=prompt.context_message,
            attempts=[],
            error="client container produced empty stdout",
        )

    try:
        payload = json.loads(raw_out.splitlines()[-1])
    except json.JSONDecodeError as exc:
        return RuntimeAgentResult(
            success=False,
            prompt=prompt.full_prompt,
            system_prompt=prompt.system_message,
            user_prompt=prompt.user_message,
            context_block=prompt.context_message,
            attempts=[],
            error=f"invalid JSON from client container: {exc}",
        )

    if not isinstance(payload, dict):
        return RuntimeAgentResult(
            success=False,
            prompt=prompt.full_prompt,
            system_prompt=prompt.system_message,
            user_prompt=prompt.user_message,
            context_block=prompt.context_message,
            attempts=[],
            error="client container JSON was not an object",
        )

    if not bool(payload.get("success")):
        return RuntimeAgentResult(
            success=False,
            prompt=prompt.full_prompt,
            system_prompt=prompt.system_message,
            user_prompt=prompt.user_message,
            context_block=prompt.context_message,
            attempts=[],
            error=str(payload.get("error") or "client container reported failure"),
        )

    response_text = str(payload.get("response_text") or "").strip()
    if not response_text:
        return RuntimeAgentResult(
            success=False,
            prompt=prompt.full_prompt,
            system_prompt=prompt.system_message,
            user_prompt=prompt.user_message,
            context_block=prompt.context_message,
            attempts=[],
            error="client container returned empty response_text",
        )

    model_used = payload.get("model_used")
    model_name = model_used if isinstance(model_used, str) and model_used else None
    attempts: list[ModelAttempt] = []
    if model_name:
        attempts.append(ModelAttempt(model=model_name, success=True))

    return RuntimeAgentResult(
        success=True,
        prompt=prompt.full_prompt,
        system_prompt=prompt.system_message,
        user_prompt=prompt.user_message,
        context_block=prompt.context_message,
        model_used=model_name,
        attempts=attempts,
        response_text=response_text,
        tool_results=[],
    )
