from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
DOCKER_SMOKE_SCRIPT = REPO_ROOT / "infra/compose/smoke/docker-smoke.sh"
DR_SMOKE_SCRIPT = REPO_ROOT / "infra/compose/smoke/dr-backup-restore.sh"
COMPOSE_FILE = REPO_ROOT / "infra/compose/docker-compose.dev.yml"


def _docker_available() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        result = subprocess.run(
            ["docker", "info"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=10,
        )
    except Exception:
        return False
    return result.returncode == 0


def test_smoke_scripts_exist_and_executable() -> None:
    assert DOCKER_SMOKE_SCRIPT.exists(), f"missing script: {DOCKER_SMOKE_SCRIPT}"
    assert DR_SMOKE_SCRIPT.exists(), f"missing script: {DR_SMOKE_SCRIPT}"
    assert os.access(DOCKER_SMOKE_SCRIPT, os.X_OK)
    assert os.access(DR_SMOKE_SCRIPT, os.X_OK)


@pytest.mark.skipif(
    os.getenv("RUN_DOCKER_SMOKE_TESTS") != "1",
    reason="set RUN_DOCKER_SMOKE_TESTS=1 to run docker smoke tests",
)
def test_run_docker_smoke_script_when_enabled() -> None:
    if not _docker_available():
        pytest.skip("docker daemon unavailable")

    result = subprocess.run(
        ["bash", str(DOCKER_SMOKE_SCRIPT), str(COMPOSE_FILE)],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        timeout=600,
        check=False,
    )
    assert result.returncode == 0, f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"


@pytest.mark.skipif(
    os.getenv("RUN_DOCKER_SMOKE_TESTS") != "1",
    reason="set RUN_DOCKER_SMOKE_TESTS=1 to run docker smoke tests",
)
def test_run_dr_smoke_script_when_enabled() -> None:
    if not _docker_available():
        pytest.skip("docker daemon unavailable")

    result = subprocess.run(
        ["bash", str(DR_SMOKE_SCRIPT), str(COMPOSE_FILE)],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        timeout=600,
        check=False,
    )
    assert result.returncode == 0, f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
