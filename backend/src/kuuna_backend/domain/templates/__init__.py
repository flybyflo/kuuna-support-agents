"""Domain module: templates."""

from kuuna_backend.domain.templates.service import (
    TemplateConflictError,
    TemplateLifecycleError,
    TemplateNotFoundError,
    TemplateServiceError,
    TemplateVersionNotFoundError,
    create_template,
    create_template_version_draft,
    get_template,
    list_template_versions,
    list_templates,
    publish_template_version,
    rollback_template_version,
)

__all__ = [
    "TemplateConflictError",
    "TemplateLifecycleError",
    "TemplateNotFoundError",
    "TemplateServiceError",
    "TemplateVersionNotFoundError",
    "create_template",
    "create_template_version_draft",
    "get_template",
    "list_template_versions",
    "list_templates",
    "publish_template_version",
    "rollback_template_version",
]
