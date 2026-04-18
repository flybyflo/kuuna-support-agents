from __future__ import annotations

import json
import time
from collections.abc import Collection, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Any, Callable

from result_schema import ToolExecutionResult, ToolInvocation

DEFAULT_TOOL_TIMEOUT_SECONDS = 2.0
ToolHandler = Callable[[dict[str, Any]], str]


def _tool_echo(arguments: dict[str, Any]) -> str:
    return str(arguments.get("text", ""))


def _tool_uppercase(arguments: dict[str, Any]) -> str:
    return str(arguments.get("text", "")).upper()


def _tool_context_lookup(arguments: dict[str, Any]) -> str:
    context = arguments.get("context") or {}
    key = arguments.get("key")
    if not isinstance(context, Mapping):
        raise ValueError("context_lookup expects a mapping in 'context'")
    if not key:
        raise ValueError("context_lookup expects a non-empty 'key'")
    if key not in context:
        raise KeyError(f"context key not found: {key}")

    value = context[key]
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


LOCAL_TOOLS: dict[str, ToolHandler] = {
    "echo": _tool_echo,
    "uppercase": _tool_uppercase,
    "context_lookup": _tool_context_lookup,
}


def _run_with_timeout(
    handler: ToolHandler,
    arguments: dict[str, Any],
    timeout_seconds: float,
) -> tuple[bool, str, str, bool]:
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(handler, arguments)
        try:
            output = future.result(timeout=timeout_seconds)
            return True, output, "", False
        except FuturesTimeoutError:
            future.cancel()
            return False, "", f"tool execution timed out after {timeout_seconds:.2f}s", True
        except Exception as exc:  # pragma: no cover - exercised via public API
            return False, "", str(exc), False


def execute_tool_call(
    tool_call: ToolInvocation,
    allowed_tools: Collection[str],
    context: Mapping[str, Any] | None = None,
) -> ToolExecutionResult:
    """Execute a single local placeholder tool if it is allowed."""

    started_at = time.perf_counter()

    if tool_call.name not in allowed_tools:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        return ToolExecutionResult(
            name=tool_call.name,
            ok=False,
            stderr=f"tool not allowed: {tool_call.name}",
            duration_ms=duration_ms,
        )

    handler = LOCAL_TOOLS.get(tool_call.name)
    if handler is None:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        return ToolExecutionResult(
            name=tool_call.name,
            ok=False,
            stderr=f"unknown local tool: {tool_call.name}",
            duration_ms=duration_ms,
        )

    arguments = dict(tool_call.arguments)
    if context is not None and "context" not in arguments:
        arguments["context"] = dict(context)

    ok, stdout, stderr, timed_out = _run_with_timeout(
        handler=handler,
        arguments=arguments,
        timeout_seconds=tool_call.timeout_seconds or DEFAULT_TOOL_TIMEOUT_SECONDS,
    )

    duration_ms = int((time.perf_counter() - started_at) * 1000)
    return ToolExecutionResult(
        name=tool_call.name,
        ok=ok,
        stdout=stdout,
        stderr=stderr,
        timed_out=timed_out,
        duration_ms=duration_ms,
    )


def execute_tool_calls(
    tool_calls: Sequence[ToolInvocation],
    allowed_tools: Collection[str],
    context: Mapping[str, Any] | None = None,
) -> list[ToolExecutionResult]:
    return [
        execute_tool_call(tool_call=tool_call, allowed_tools=allowed_tools, context=context)
        for tool_call in tool_calls
    ]
