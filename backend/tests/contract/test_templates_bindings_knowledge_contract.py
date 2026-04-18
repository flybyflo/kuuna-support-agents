from __future__ import annotations

from fastapi.testclient import TestClient


def test_templates_and_bindings_contract_flow(client: TestClient) -> None:
    template_response = client.post(
        "/templates",
        json={"key": "contract-template", "display_name": "Contract Template"},
    )
    assert template_response.status_code == 201
    template_id = template_response.json()["id"]

    draft_response = client.post(
        f"/templates/{template_id}/versions",
        json={
            "system_prompt": "You are contract bot",
            "model_settings": {"provider": "openai", "model_name": "gpt-4.1-mini"},
            "tools_config": {},
            "egress_policy": {},
        },
    )
    assert draft_response.status_code == 201
    draft_version_id = draft_response.json()["id"]
    assert draft_response.json()["status"] == "draft"

    # Binding with an unpublished template version must fail.
    conflict_response = client.post(
        "/bindings",
        json={
            "provider_group_id": "contract-group@g.us",
            "template_version_id": draft_version_id,
        },
    )
    assert conflict_response.status_code == 409

    publish_response = client.post(f"/templates/{template_id}/versions/{draft_version_id}/publish")
    assert publish_response.status_code == 200
    assert publish_response.json()["status"] == "published"

    binding_response = client.post(
        "/bindings",
        json={
            "provider_group_id": "contract-group@g.us",
            "template_version_id": draft_version_id,
        },
    )
    assert binding_response.status_code == 201
    binding_id = binding_response.json()["id"]
    assert binding_response.json()["status"] == "active"

    unbind_response = client.delete(f"/bindings/{binding_id}")
    assert unbind_response.status_code == 200
    assert unbind_response.json()["status"] == "inactive"


def test_knowledge_contract_flow_common_and_group(client: TestClient) -> None:
    common_doc_response = client.post(
        "/knowledge/common-docs",
        json={"doc_key": "contract-common", "title": "Contract Common"},
    )
    assert common_doc_response.status_code == 201
    common_doc_id = common_doc_response.json()["id"]

    v1_common = client.post(
        f"/knowledge/common-docs/{common_doc_id}/versions",
        json={"content_markdown": "# Common V1"},
    )
    assert v1_common.status_code == 201
    v1_common_id = v1_common.json()["id"]

    publish_v1 = client.post(f"/knowledge/common-docs/{common_doc_id}/versions/{v1_common_id}/publish")
    assert publish_v1.status_code == 200
    assert publish_v1.json()["status"] == "published"

    v2_common = client.post(
        f"/knowledge/common-docs/{common_doc_id}/versions",
        json={"content_markdown": "# Common V2"},
    )
    assert v2_common.status_code == 201
    v2_common_id = v2_common.json()["id"]

    publish_v2 = client.post(f"/knowledge/common-docs/{common_doc_id}/versions/{v2_common_id}/publish")
    assert publish_v2.status_code == 200

    rollback_v1 = client.post(f"/knowledge/common-docs/{common_doc_id}/versions/{v1_common_id}/rollback")
    assert rollback_v1.status_code == 200
    assert rollback_v1.json()["status"] == "published"

    group_doc_response = client.post(
        "/knowledge/group-docs",
        json={
            "provider_group_id": "contract-group@g.us",
            "doc_key": "contract-group",
            "title": "Contract Group",
        },
    )
    assert group_doc_response.status_code == 201
    group_doc_id = group_doc_response.json()["id"]

    group_version = client.post(
        f"/knowledge/group-docs/{group_doc_id}/versions",
        json={"content_markdown": "# Group V1"},
    )
    assert group_version.status_code == 201
    group_version_id = group_version.json()["id"]

    publish_group = client.post(f"/knowledge/group-docs/{group_doc_id}/versions/{group_version_id}/publish")
    assert publish_group.status_code == 200
    assert publish_group.json()["status"] == "published"

    list_group_docs = client.get("/knowledge/group-docs/contract-group@g.us")
    assert list_group_docs.status_code == 200
    assert len(list_group_docs.json()) == 1
