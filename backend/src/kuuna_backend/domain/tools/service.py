from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kuuna_backend.db.models import ToolCatalogEntry, ToolRiskClass


class ToolCatalogError(Exception):
    """Base error for tool catalog operations."""


class ToolCatalogValidationError(ToolCatalogError):
    """Raised when a tool payload is invalid."""


@dataclass(frozen=True, slots=True)
class DefaultToolDefinition:
    tool_key: str
    display_name: str
    description: str
    risk_class: ToolRiskClass
    category: str = "runtime"


DEFAULT_TOOL_CATALOG: tuple[DefaultToolDefinition, ...] = (
    DefaultToolDefinition(
        tool_key="echo",
        display_name="Echo",
        description="Returns the provided input text unchanged. Useful for connectivity checks.",
        risk_class=ToolRiskClass.READ,
        category="utility",
    ),
    DefaultToolDefinition(
        tool_key="uppercase",
        display_name="Uppercase",
        description="Transforms text to uppercase for deterministic formatting tests.",
        risk_class=ToolRiskClass.READ,
        category="utility",
    ),
    DefaultToolDefinition(
        tool_key="context_lookup",
        display_name="Context Lookup",
        description="Reads a specific key from runtime context assembled for the current message.",
        risk_class=ToolRiskClass.READ,
        category="context",
    ),
    DefaultToolDefinition(
        tool_key="knowledge_search",
        display_name="Knowledge Search",
        description="Searches published group/common knowledge and returns ranked passages.",
        risk_class=ToolRiskClass.READ,
        category="knowledge",
    ),
    DefaultToolDefinition(
        tool_key="message_history",
        display_name="Message History",
        description="Reads recent group conversation history for retrieval-augmented responses.",
        risk_class=ToolRiskClass.READ,
        category="context",
    ),
    DefaultToolDefinition(
        tool_key="todo_create",
        display_name="Create Todo",
        description="Creates a staff todo in the dashboard for this group.",
        risk_class=ToolRiskClass.WRITE,
        category="workflow",
    ),
    DefaultToolDefinition(
        tool_key="todo_update",
        display_name="Update Todo",
        description="Updates a staff todo in the dashboard for this group.",
        risk_class=ToolRiskClass.WRITE,
        category="workflow",
    ),
    DefaultToolDefinition(
        tool_key="todo_list",
        display_name="List Todos",
        description="Reads open staff todos for this group.",
        risk_class=ToolRiskClass.READ,
        category="workflow",
    ),
    DefaultToolDefinition(
        tool_key="send_whatsapp",
        display_name="Send WhatsApp",
        description="Sends outbound WhatsApp messages via the gateway (uses outbound_intent idempotency).",
        risk_class=ToolRiskClass.WRITE,
        category="communication",
    ),
)


def list_tool_catalog(
    db: Session,
    *,
    include_disabled: bool = True,
    bootstrap_defaults: bool = True,
) -> list[ToolCatalogEntry]:
    if bootstrap_defaults:
        _ensure_default_catalog_entries(db)

    stmt = select(ToolCatalogEntry)
    if not include_disabled:
        stmt = stmt.where(ToolCatalogEntry.is_enabled.is_(True))

    stmt = stmt.order_by(
        ToolCatalogEntry.category.asc(),
        ToolCatalogEntry.risk_class.asc(),
        ToolCatalogEntry.display_name.asc(),
    )
    return list(db.scalars(stmt).all())


def upsert_tool_catalog_entry(
    db: Session,
    *,
    tool_key: str,
    display_name: str,
    description: str,
    risk_class: ToolRiskClass,
    category: str = "runtime",
    is_enabled: bool = True,
) -> ToolCatalogEntry:
    normalized_key = tool_key.strip().lower()
    normalized_name = display_name.strip()
    normalized_description = description.strip()
    normalized_category = category.strip().lower() or "runtime"

    if not normalized_key:
        raise ToolCatalogValidationError("tool_key must not be empty")
    if not normalized_name:
        raise ToolCatalogValidationError("display_name must not be empty")
    if not normalized_description:
        raise ToolCatalogValidationError("description must not be empty")

    existing = db.scalar(select(ToolCatalogEntry).where(ToolCatalogEntry.tool_key == normalized_key))
    if existing is None:
        entry = ToolCatalogEntry(
            tool_key=normalized_key,
            display_name=normalized_name,
            description=normalized_description,
            risk_class=risk_class,
            category=normalized_category,
            is_enabled=is_enabled,
        )
        db.add(entry)
    else:
        existing.display_name = normalized_name
        existing.description = normalized_description
        existing.risk_class = risk_class
        existing.category = normalized_category
        existing.is_enabled = is_enabled
        entry = existing

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ToolCatalogValidationError(f"tool key '{normalized_key}' already exists") from exc

    db.refresh(entry)
    return entry


def _ensure_default_catalog_entries(db: Session) -> None:
    existing_keys = set(db.scalars(select(ToolCatalogEntry.tool_key)).all())

    missing_entries = [entry for entry in DEFAULT_TOOL_CATALOG if entry.tool_key not in existing_keys]
    if not missing_entries:
        return

    for definition in missing_entries:
        db.add(
            ToolCatalogEntry(
                tool_key=definition.tool_key,
                display_name=definition.display_name,
                description=definition.description,
                risk_class=definition.risk_class,
                category=definition.category,
                is_enabled=True,
            )
        )

    db.commit()
