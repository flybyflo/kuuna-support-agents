from __future__ import annotations

from collections.abc import Generator
from typing import Any
from uuid import uuid4

import httpx
import pytest

from kuuna_backend.config.settings import get_settings
from kuuna_backend.db.models import AgentInstance
from kuuna_backend.domain.runtime import provisioning


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> Generator[None, None, None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class _FakeDockerClient:
    def __init__(self) -> None:
        self.created_payload: dict[str, Any] | None = None
        self.started_container_id: str | None = None

    def __enter__(self) -> "_FakeDockerClient":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def get(self, path: str) -> httpx.Response:
        if path == "/images/kuuna-runtime-agent-ts:dev/json":
            return httpx.Response(200, json={"Id": "sha256:runtime-dev"})
        if path == "/containers/kuuna-runtime-group-a-at-g.us/json":
            return httpx.Response(404)
        if path == "/containers/container-1/json":
            return httpx.Response(
                200,
                json={
                    "Id": "container-1",
                    "State": {"Running": False},
                    "NetworkSettings": {"Networks": {}},
                },
            )
        raise AssertionError(f"unexpected docker GET {path}")

    def post(
        self,
        path: str,
        *,
        params: dict[str, object] | None = None,
        json: dict[str, Any] | None = None,
    ) -> httpx.Response:
        if path == "/containers/create":
            assert params == {"name": "kuuna-runtime-group-a-at-g.us"}
            self.created_payload = json
            return httpx.Response(201, json={"Id": "container-1"})
        if path == "/containers/container-1/start":
            self.started_container_id = "container-1"
            return httpx.Response(204)
        raise AssertionError(f"unexpected docker POST {path}")


class _FakeStaleDockerClient:
    def __init__(self, *, agent_instance_id: str) -> None:
        self.agent_instance_id = agent_instance_id
        self.created_payload: dict[str, Any] | None = None
        self.deleted_container_id: str | None = None
        self.started_container_id: str | None = None

    def __enter__(self) -> "_FakeStaleDockerClient":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def get(self, path: str) -> httpx.Response:
        if path == "/images/kuuna-runtime-agent-ts:new/json":
            return httpx.Response(200, json={"Id": "sha256:runtime-new"})
        if path == "/containers/kuuna-runtime-group-a-at-g.us/json":
            return httpx.Response(
                200,
                json={
                    "Id": "container-old",
                    "Image": "sha256:runtime-old",
                    "State": {"Running": False},
                    "Config": {
                        "Image": "kuuna-runtime-agent-ts:old",
                        "Env": ["OPENAI_API_KEY=old-secret"],
                        "Labels": {
                            "dev.kuuna.managed-runtime": "true",
                            "dev.kuuna.agent-instance-id": self.agent_instance_id,
                            "dev.kuuna.provider-group-id": "group-a@g.us",
                            "dev.kuuna.secrets-ref": "runtime/group-a-at-g.us",
                        },
                    },
                    "NetworkSettings": {"Networks": {}},
                },
            )
        if path == "/containers/container-new/json":
            return httpx.Response(
                200,
                json={
                    "Id": "container-new",
                    "State": {"Running": False},
                    "NetworkSettings": {"Networks": {}},
                },
            )
        raise AssertionError(f"unexpected docker GET {path}")

    def post(
        self,
        path: str,
        *,
        params: dict[str, object] | None = None,
        json: dict[str, Any] | None = None,
    ) -> httpx.Response:
        if path == "/containers/create":
            assert params == {"name": "kuuna-runtime-group-a-at-g.us"}
            self.created_payload = json
            return httpx.Response(201, json={"Id": "container-new"})
        if path == "/containers/container-new/start":
            self.started_container_id = "container-new"
            return httpx.Response(204)
        raise AssertionError(f"unexpected docker POST {path}")

    def delete(
        self,
        path: str,
        *,
        params: dict[str, object] | None = None,
    ) -> httpx.Response:
        if path == "/containers/container-old":
            assert params == {"force": True, "v": False}
            self.deleted_container_id = "container-old"
            return httpx.Response(204)
        raise AssertionError(f"unexpected docker DELETE {path}")


class _FakeStopUnmanagedDockerClient:
    def __init__(self) -> None:
        self.stop_called = False

    def __enter__(self) -> "_FakeStopUnmanagedDockerClient":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def get(self, path: str) -> httpx.Response:
        if path == "/containers/kuuna-runtime-group-a-at-g.us/json":
            return httpx.Response(
                200,
                json={
                    "Id": "container-foreign",
                    "State": {"Running": True},
                    "Config": {"Labels": {}},
                },
            )
        raise AssertionError(f"unexpected docker GET {path}")

    def post(
        self,
        path: str,
        *,
        params: dict[str, object] | None = None,
        json: dict[str, Any] | None = None,
    ) -> httpx.Response:
        self.stop_called = True
        raise AssertionError(f"unexpected docker POST {path}")


def test_provision_runtime_container_creates_group_container(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RUNTIME_DOCKER_NETWORK", "kuuna-dev_default")
    monkeypatch.setenv("RUNTIME_AGENT_IMAGE", "kuuna-runtime-agent-ts:dev")
    monkeypatch.setenv("OPENAI_API_KEY", "global-key")
    monkeypatch.setenv("RUNTIME_CONTAINER_EXTRA_ENV_JSON", '{"EXTRA_FLAG": true}')
    monkeypatch.setenv(
        "KUUNA_SECRET_RUNTIME_GROUP_A_AT_G_US",
        '{"OPENAI_API_KEY": "secret-key", "CLIENT_SECRET": "client-secret"}',
    )

    fake_client = _FakeDockerClient()
    monkeypatch.setattr(provisioning, "_docker_client", lambda _socket: fake_client)
    health_checks: list[str] = []
    monkeypatch.setattr(provisioning, "_wait_for_runtime_health", health_checks.append)

    agent_instance = AgentInstance(
        id=uuid4(),
        group_binding_id=uuid4(),
        runtime_container_name="kuuna-runtime-group-a-at-g.us",
        secrets_ref="runtime/group-a-at-g.us",
    )

    result = provisioning.provision_runtime_container(
        agent_instance,
        provider_group_id="group-a@g.us",
    )

    assert result.container_id == "container-1"
    assert result.runtime_base_url == "http://kuuna-runtime-group-a-at-g.us:8100"
    assert result.docker_network == "kuuna-dev_default"
    assert fake_client.started_container_id == "container-1"
    assert health_checks == ["http://kuuna-runtime-group-a-at-g.us:8100"]
    assert fake_client.created_payload is not None
    assert fake_client.created_payload["Image"] == "kuuna-runtime-agent-ts:dev"
    assert fake_client.created_payload["Cmd"] == ["npm", "run", "serve"]
    assert fake_client.created_payload["HostConfig"]["NetworkMode"] == "kuuna-dev_default"
    assert fake_client.created_payload["NetworkingConfig"] == {
        "EndpointsConfig": {
            "kuuna-dev_default": {"Aliases": ["kuuna-runtime-group-a-at-g.us"]},
        },
    }
    assert fake_client.created_payload["HostConfig"]["Binds"] == [
        "kuuna-runtime-data-kuuna-runtime-group-a-at-g.us:/runtime-data",
    ]
    labels = fake_client.created_payload["Labels"]
    assert labels["dev.kuuna.runtime-image-id"] == "sha256:runtime-dev"
    assert labels["dev.kuuna.runtime-config-hash"]

    env = dict(item.split("=", 1) for item in fake_client.created_payload["Env"])
    assert env["OPENAI_API_KEY"] == "secret-key"
    assert env["RUNTIME_AGENT_DEFAULT_MODEL"] == "gpt-5.5"
    assert env["RUNTIME_AGENT_REASONING_EFFORT"] == "medium"
    assert env["KUUNA_PROVIDER_GROUP_ID"] == "group-a@g.us"
    assert env["KUUNA_SECRETS_REF"] == "runtime/group-a-at-g.us"
    assert env["CLIENT_SECRET"] == "client-secret"
    assert env["EXTRA_FLAG"] == "True"


def test_provision_runtime_container_recreates_stale_managed_container(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RUNTIME_DOCKER_NETWORK", "kuuna-dev_default")
    monkeypatch.setenv("RUNTIME_AGENT_IMAGE", "kuuna-runtime-agent-ts:new")
    monkeypatch.setenv(
        "KUUNA_SECRET_RUNTIME_GROUP_A_AT_G_US",
        '{"OPENAI_API_KEY": "new-secret"}',
    )

    agent_instance = AgentInstance(
        id=uuid4(),
        group_binding_id=uuid4(),
        runtime_container_name="kuuna-runtime-group-a-at-g.us",
        secrets_ref="runtime/group-a-at-g.us",
    )
    fake_client = _FakeStaleDockerClient(agent_instance_id=str(agent_instance.id))
    monkeypatch.setattr(provisioning, "_docker_client", lambda _socket: fake_client)
    monkeypatch.setattr(provisioning, "_wait_for_runtime_health", lambda _runtime_base_url: None)

    result = provisioning.provision_runtime_container(
        agent_instance,
        provider_group_id="group-a@g.us",
    )

    assert result.container_id == "container-new"
    assert fake_client.deleted_container_id == "container-old"
    assert fake_client.started_container_id == "container-new"
    assert fake_client.created_payload is not None
    assert fake_client.created_payload["Image"] == "kuuna-runtime-agent-ts:new"
    env = dict(item.split("=", 1) for item in fake_client.created_payload["Env"])
    assert env["OPENAI_API_KEY"] == "new-secret"


def test_container_runtime_config_match_rejects_image_rebuild_and_removed_env() -> None:
    agent_instance = AgentInstance(
        id=uuid4(),
        group_binding_id=uuid4(),
        runtime_container_name="kuuna-runtime-group-a-at-g.us",
        secrets_ref="runtime/group-a-at-g.us",
    )
    base_labels = provisioning._build_labels(agent_instance, provider_group_id="group-a@g.us")
    desired_env = ["OPENAI_API_KEY=new-secret", "PORT=8100"]
    desired_labels = provisioning._with_runtime_config_labels(
        base_labels,
        image="kuuna-runtime-agent-ts:dev",
        image_id="sha256:runtime-new",
        env=desired_env,
    )
    stale_labels = provisioning._with_runtime_config_labels(
        base_labels,
        image="kuuna-runtime-agent-ts:dev",
        image_id="sha256:runtime-old",
        env=[*desired_env, "REMOVED_SECRET=old"],
    )
    details = {
        "Image": "sha256:runtime-old",
        "Config": {
            "Image": "kuuna-runtime-agent-ts:dev",
            "Env": [*desired_env, "REMOVED_SECRET=old"],
            "Labels": stale_labels,
        },
    }

    assert not provisioning._container_matches_runtime_config(
        details,
        image="kuuna-runtime-agent-ts:dev",
        image_id="sha256:runtime-new",
        labels=desired_labels,
    )


def test_stop_runtime_container_refuses_unmanaged_container(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RUNTIME_PROVISIONING_ENABLED", "true")
    fake_client = _FakeStopUnmanagedDockerClient()
    monkeypatch.setattr(provisioning, "_docker_client", lambda _socket: fake_client)

    agent_instance = AgentInstance(
        id=uuid4(),
        group_binding_id=uuid4(),
        runtime_container_name="kuuna-runtime-group-a-at-g.us",
        secrets_ref="runtime/group-a-at-g.us",
    )

    with pytest.raises(provisioning.RuntimeProvisioningError):
        provisioning.stop_runtime_container(agent_instance)

    assert fake_client.stop_called is False
