from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException

from result_schema import RunnerInput, RuntimeAgentResult
from runner import run_agent

app = FastAPI(title="Kuuna Runtime Agent", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/debug/status")
def debug_status() -> dict[str, object]:
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    return {
        "status": "ok",
        "openai_configured": bool(openai_key),
        "openai_base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        "openai_timeout_seconds": os.getenv("OPENAI_TIMEOUT_SECONDS", "30"),
    }


@app.post("/run", response_model=RuntimeAgentResult)
def run_runtime_agent(payload: RunnerInput) -> RuntimeAgentResult:
    try:
        return run_agent(payload)
    except Exception as exc:  # pragma: no cover - defensive API boundary
        raise HTTPException(status_code=500, detail=f"runtime-agent execution failed: {exc}") from exc
