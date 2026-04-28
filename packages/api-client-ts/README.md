# API Client TS

Shared dashboard/backend API read-model types plus a small typed client for the
backend read endpoints used by the dashboard.

This remains the package boundary for future OpenAPI generation; dashboard code
imports types and backend endpoint adapters through this package instead of
owning local API contracts.
