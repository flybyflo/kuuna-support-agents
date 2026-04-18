"""Domain module: audit."""

from kuuna_backend.domain.audit.service import append_audit_event

__all__ = ["append_audit_event"]
