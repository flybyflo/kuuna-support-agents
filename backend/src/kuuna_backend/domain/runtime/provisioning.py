from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import httpx

from kuuna_backend.config.settings import get_settings
from kuuna_backend.db.models import AgentInstance
from kuuna_backend.integrations.secret_manager import SecretManagerError, load_secret_mapping

logger = logging.getLogger(__name__)

_DEFAULT_AGENT_MODEL = "gpt-5.5"
_DEFAULT_REASONING_EFFORT = "medium"
_MANAGED_LABEL = "dev.kuuna.managed-runtime"
_AGENT_INSTANCE_LABEL = "dev.kuuna.agent-instance-id"
_PROVIDER_GROUP_LABEL = "dev.kuuna.provider-group-id"
_SECRETS_REF_LABEL = "dev.kuuna.secrets-ref"
_IMAGE_ID_LABEL = "dev.kuuna.runtime-image-id"
_CONFIG_HASH_LABEL = "dev.kuuna.runtime-config-hash"
_HEALTHCHECK_ATTEMPTS = 20
_HEALTHCHECK_INTERVAL_SECONDS = 0.25
_HEALTHCHECK_TIMEOUT_SECONDS = 2.0


class RuntimeProvisioningError(Exception):
    """Raised when the per-group runtime container cannot be provisioned."""


@dataclass(frozen=True, slots=True)
class RuntimeProvisioningResult:
    container_id: str
    container_name: str
    runtime_base_url: str
    docker_network: str | None


def runtime_provisioning_enabled() -> bool:
    return get_settings().runtime_provisioning_enabled


def provision_runtime_container(
    agent_instance: AgentInstance,
    *,
    provider_group_id: str,
    image: str | None = None,
) -> RuntimeProvisioningResult:
    settings = get_settings()
    container_name = _required_container_name(agent_instance)
    network_name = _normalize_optional(settings.runtime_docker_network)
    port = settings.runtime_agent_container_port
    image = (image or settings.runtime_agent_image).strip()
    if not image:
        raise RuntimeProvisioningError("runtime image is required")
    labels = _build_labels(agent_instance, provider_group_id=provider_group_id)
    data_volume_name = _data_volume_name(container_name)

    try:
        env = _build_container_env(
            agent_instance,
            provider_group_id=provider_group_id,
        )
    except SecretManagerError as exc:
        raise RuntimeProvisioningError("failed to load runtime container secrets") from exc

    with _docker_client(settings.runtime_docker_socket) as client:
        if network_name is None:
            network_name = _detect_current_docker_network(client)

        image_id = _get_image_id(client, image)
        labels = _with_runtime_config_labels(
            labels,
            image=image,
            image_id=image_id,
            env=env,
        )

        details = _get_container(client, container_name)
        if details is None:
            container_id = _create_container(
                client,
                container_name=container_name,
                image=image,
                port=port,
                env=env,
                labels=labels,
                network_name=network_name,
                data_volume_name=data_volume_name,
                data_dir=settings.runtime_container_data_dir,
            )
        else:
            existing_container_id = _string_value(details, "Id")
            if not existing_container_id:
                raise RuntimeProvisioningError(f"container {container_name} has no Docker id")
            if not _container_is_managed_runtime(details):
                raise RuntimeProvisioningError(
                    f"container {container_name} exists but is not a Kuuna-managed runtime"
                )
            if not _container_matches_runtime_config(
                details,
                image=image,
                image_id=image_id,
                labels=labels,
            ):
                _remove_container(client, container_id=existing_container_id, container_name=container_name)
                container_id = _create_container(
                    client,
                    container_name=container_name,
                    image=image,
                    port=port,
                    env=env,
                    labels=labels,
                    network_name=network_name,
                    data_volume_name=data_volume_name,
                    data_dir=settings.runtime_container_data_dir,
                )
            else:
                container_id = existing_container_id
                _ensure_container_network(
                    client,
                    container_id=container_id,
                    container_name=container_name,
                    details=details,
                    network_name=network_name,
                )

        _start_container(client, container_id=container_id, container_name=container_name)

    runtime_base_url = f"http://{container_name}:{port}"
    _wait_for_runtime_health(runtime_base_url)

    return RuntimeProvisioningResult(
        container_id=container_id,
        container_name=container_name,
        runtime_base_url=runtime_base_url,
        docker_network=network_name,
    )


def stop_runtime_container(agent_instance: AgentInstance) -> bool:
    if not runtime_provisioning_enabled():
        return False

    settings = get_settings()
    container_name = _required_container_name(agent_instance)

    with _docker_client(settings.runtime_docker_socket) as client:
        details = _get_container(client, container_name)
        if details is None:
            return False

        container_id = _string_value(details, "Id")
        if not container_id:
            return False
        if not _container_is_managed_runtime(details):
            raise RuntimeProvisioningError(
                f"container {container_name} exists but is not a Kuuna-managed runtime"
            )
        if not _container_matches_agent_identity(details, agent_instance):
            raise RuntimeProvisioningError(
                f"container {container_name} is managed by another agent instance"
            )
        if not _container_is_running(details):
            return False

        response = client.post(f"/containers/{container_id}/stop", params={"t": 10})
        if response.status_code in {204, 304}:
            return True
        _raise_docker_error(response, f"stop container {container_name}")

    return True


def _docker_client(docker_socket: str) -> httpx.Client:
    transport = httpx.HTTPTransport(uds=docker_socket)
    return httpx.Client(transport=transport, base_url="http://docker", timeout=20.0)


def _get_container(client: httpx.Client, container_name: str) -> dict[str, Any] | None:
    response = client.get(f"/containers/{container_name}/json")
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        _raise_docker_error(response, f"inspect container {container_name}")

    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeProvisioningError(f"Docker returned invalid inspect payload for {container_name}")
    return payload


def _get_image_id(client: httpx.Client, image: str) -> str:
    response = client.get(f"/images/{image}/json")
    if response.status_code >= 400:
        _raise_docker_error(response, f"inspect image {image}")

    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeProvisioningError(f"Docker returned invalid image payload for {image}")

    image_id = _string_value(payload, "Id")
    if not image_id:
        raise RuntimeProvisioningError(f"Docker image {image} has no id")
    return image_id


def _create_container(
    client: httpx.Client,
    *,
    container_name: str,
    image: str,
    port: int,
    env: list[str],
    labels: dict[str, str],
    network_name: str | None,
    data_volume_name: str,
    data_dir: str,
) -> str:
    exposed_port = f"{port}/tcp"
    host_config: dict[str, Any] = {
        "RestartPolicy": {"Name": "unless-stopped"},
        "Binds": [f"{data_volume_name}:{data_dir}"],
    }
    networking_config: dict[str, Any] | None = None
    if network_name:
        host_config["NetworkMode"] = network_name
        networking_config = {"EndpointsConfig": {network_name: {"Aliases": [container_name]}}}

    payload: dict[str, Any] = {
        "Image": image,
        "Cmd": ["npm", "run", "serve"],
        "Env": env,
        "Labels": labels,
        "ExposedPorts": {exposed_port: {}},
        "HostConfig": host_config,
    }
    if networking_config is not None:
        payload["NetworkingConfig"] = networking_config

    response = client.post("/containers/create", params={"name": container_name}, json=payload)
    if response.status_code != 201:
        _raise_docker_error(response, f"create container {container_name}")

    body = response.json()
    if not isinstance(body, dict):
        raise RuntimeProvisioningError(f"Docker returned invalid create payload for {container_name}")

    container_id = _string_value(body, "Id")
    if not container_id:
        raise RuntimeProvisioningError(f"Docker did not return an id for {container_name}")
    return container_id


def _ensure_container_network(
    client: httpx.Client,
    *,
    container_id: str,
    container_name: str,
    details: dict[str, Any],
    network_name: str | None,
) -> None:
    if not network_name:
        return
    if network_name in _container_network_names(details):
        return

    response = client.post(
        f"/networks/{network_name}/connect",
        json={"Container": container_id, "EndpointConfig": {"Aliases": [container_name]}},
    )
    if response.status_code not in {200, 201, 204}:
        _raise_docker_error(response, f"connect container {container_name} to network {network_name}")


def _start_container(client: httpx.Client, *, container_id: str, container_name: str) -> None:
    details = _get_container(client, container_id)
    if details is not None and _container_is_running(details):
        return

    response = client.post(f"/containers/{container_id}/start")
    if response.status_code not in {204, 304}:
        _raise_docker_error(response, f"start container {container_name}")


def _remove_container(client: httpx.Client, *, container_id: str, container_name: str) -> None:
    response = client.delete(f"/containers/{container_id}", params={"force": True, "v": False})
    if response.status_code not in {204, 404}:
        _raise_docker_error(response, f"remove stale container {container_name}")


def _wait_for_runtime_health(runtime_base_url: str) -> None:
    health_url = f"{runtime_base_url.rstrip('/')}/healthz"
    last_error = "no response"
    for attempt in range(_HEALTHCHECK_ATTEMPTS):
        try:
            response = httpx.get(health_url, timeout=_HEALTHCHECK_TIMEOUT_SECONDS)
            if 200 <= response.status_code < 300:
                return
            last_error = f"HTTP {response.status_code}"
        except httpx.HTTPError as exc:
            last_error = str(exc)

        if attempt < _HEALTHCHECK_ATTEMPTS - 1:
            time.sleep(_HEALTHCHECK_INTERVAL_SECONDS)

    raise RuntimeProvisioningError(
        f"runtime container did not become healthy at {health_url}: {last_error}"
    )


def _detect_current_docker_network(client: httpx.Client) -> str | None:
    hostname = os.getenv("HOSTNAME")
    if not hostname:
        return None

    details = _get_container(client, hostname)
    if details is None:
        return None

    networks = [name for name in _container_network_names(details) if name not in {"bridge", "host", "none"}]
    if not networks:
        return None
    return sorted(networks)[0]


def _build_container_env(agent_instance: AgentInstance, *, provider_group_id: str) -> list[str]:
    settings = get_settings()
    env: dict[str, str] = {
        "PORT": str(settings.runtime_agent_container_port),
        "OPENAI_BASE_URL": settings.openai_base_url,
        "OPENAI_TIMEOUT_SECONDS": str(settings.openai_timeout_seconds),
        "RUNTIME_AGENT_DEFAULT_MODEL": _DEFAULT_AGENT_MODEL,
        "RUNTIME_AGENT_REASONING_EFFORT": _DEFAULT_REASONING_EFFORT,
        "KUUNA_PROVIDER_GROUP_ID": provider_group_id,
        "KUUNA_AGENT_INSTANCE_ID": str(agent_instance.id),
        "KUUNA_SECRETS_REF": agent_instance.secrets_ref or "",
        "KUUNA_RUNTIME_DATA_DIR": settings.runtime_container_data_dir,
    }
    if settings.openai_api_key:
        env["OPENAI_API_KEY"] = settings.openai_api_key

    env.update(_parse_extra_env(settings.runtime_container_extra_env_json))
    env.update(load_secret_mapping(agent_instance.secrets_ref))

    return [f"{key}={value}" for key, value in sorted(env.items())]


def _parse_extra_env(raw_value: str | None) -> dict[str, str]:
    raw_value = _normalize_optional(raw_value)
    if raw_value is None:
        return {}

    try:
        decoded = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise RuntimeProvisioningError("RUNTIME_CONTAINER_EXTRA_ENV_JSON must be valid JSON") from exc

    if not isinstance(decoded, dict):
        raise RuntimeProvisioningError("RUNTIME_CONTAINER_EXTRA_ENV_JSON must be a JSON object")

    env: dict[str, str] = {}
    for key, value in decoded.items():
        if not isinstance(key, str) or not key or "=" in key:
            raise RuntimeProvisioningError("RUNTIME_CONTAINER_EXTRA_ENV_JSON contains an invalid key")
        if value is None:
            continue
        if isinstance(value, str):
            env[key] = value
        elif isinstance(value, bool | int | float):
            env[key] = str(value)
        else:
            raise RuntimeProvisioningError("RUNTIME_CONTAINER_EXTRA_ENV_JSON values must be scalar")
    return env


def _build_labels(agent_instance: AgentInstance, *, provider_group_id: str) -> dict[str, str]:
    return {
        _MANAGED_LABEL: "true",
        _AGENT_INSTANCE_LABEL: str(agent_instance.id),
        _PROVIDER_GROUP_LABEL: provider_group_id,
        _SECRETS_REF_LABEL: agent_instance.secrets_ref or "",
    }


def _with_runtime_config_labels(
    labels: dict[str, str],
    *,
    image: str,
    image_id: str,
    env: list[str],
) -> dict[str, str]:
    runtime_labels = dict(labels)
    runtime_labels[_IMAGE_ID_LABEL] = image_id
    runtime_labels[_CONFIG_HASH_LABEL] = _runtime_config_hash(
        image=image,
        image_id=image_id,
        env=env,
        labels=labels,
    )
    return runtime_labels


def _runtime_config_hash(
    *,
    image: str,
    image_id: str,
    env: list[str],
    labels: dict[str, str],
) -> str:
    payload = {
        "image": image,
        "image_id": image_id,
        "env": sorted(env),
        "labels": sorted(labels.items()),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _container_is_managed_runtime(details: dict[str, Any]) -> bool:
    labels = _container_labels(details)
    return labels.get(_MANAGED_LABEL) == "true"


def _container_matches_agent_identity(details: dict[str, Any], agent_instance: AgentInstance) -> bool:
    labels = _container_labels(details)
    if labels.get(_AGENT_INSTANCE_LABEL) != str(agent_instance.id):
        return False
    if labels.get(_SECRETS_REF_LABEL) != (agent_instance.secrets_ref or ""):
        return False
    return True


def _container_matches_runtime_config(
    details: dict[str, Any],
    *,
    image: str,
    image_id: str,
    labels: dict[str, str],
) -> bool:
    config = details.get("Config")
    if not isinstance(config, dict):
        return False
    if config.get("Image") != image:
        return False
    if details.get("Image") != image_id:
        return False

    existing_labels = _container_labels(details)
    for key, value in labels.items():
        if existing_labels.get(key) != value:
            return False
    return True


def _container_is_running(details: dict[str, Any]) -> bool:
    state = details.get("State")
    return isinstance(state, dict) and state.get("Running") is True


def _container_network_names(details: dict[str, Any]) -> set[str]:
    network_settings = details.get("NetworkSettings")
    if not isinstance(network_settings, dict):
        return set()
    networks = network_settings.get("Networks")
    if not isinstance(networks, dict):
        return set()
    return {key for key in networks if isinstance(key, str)}


def _container_labels(details: dict[str, Any]) -> dict[str, str]:
    config = details.get("Config")
    if not isinstance(config, dict):
        return {}
    labels = config.get("Labels")
    if not isinstance(labels, dict):
        return {}
    return {key: value for key, value in labels.items() if isinstance(key, str) and isinstance(value, str)}


def _env_items_to_dict(items: object) -> dict[str, str]:
    if not isinstance(items, list):
        return {}
    env: dict[str, str] = {}
    for item in items:
        if not isinstance(item, str) or "=" not in item:
            continue
        key, value = item.split("=", 1)
        env[key] = value
    return env


def _required_container_name(agent_instance: AgentInstance) -> str:
    container_name = _normalize_optional(agent_instance.runtime_container_name)
    if container_name is None:
        raise RuntimeProvisioningError("agent instance has no runtime container name")
    return container_name


def _data_volume_name(container_name: str) -> str:
    prefix = get_settings().runtime_container_data_volume_prefix.strip() or "kuuna-runtime-data"
    return f"{prefix}-{container_name}"[:255]


def _normalize_optional(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _string_value(mapping: Mapping[str, Any], key: str) -> str | None:
    value = mapping.get(key)
    return value if isinstance(value, str) and value else None


def _raise_docker_error(response: httpx.Response, action: str) -> None:
    detail = response.text[:500]
    logger.warning(
        "runtime_docker_request_failed",
        extra={"action": action, "status_code": response.status_code},
    )
    raise RuntimeProvisioningError(f"Docker failed to {action}: {response.status_code} {detail}")
