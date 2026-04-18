# Dashboard (Frontend) Agent Guide

## Project Snapshot
- Frontend app path: `apps/dashboard`
- Purpose: staff dashboard for templates, bindings, knowledge, messages, and audit views.
- Stack target: Next.js 15 + TypeScript (scaffold phase).

## Setup & Commands
- Run the frontend via Docker Compose from repo root:
  - `npm run dev`
- Use container execution for frontend commands when needed:
  - `docker compose -f infra/compose/docker-compose.dev.yml exec dashboard <command>`
- Keep host-side `npm` execution for scaffolding/package edits only.

## Coding Rules
- Use generated API client types; do not add ad-hoc API contracts.
- Keep route ownership under `src/app/(protected)/*` by domain (`templates`, `bindings`, `knowledge`, `messages`, `audit`).
- Keep shared UI in `src/components` and app wiring/helpers in `src/lib`.

## Testing Expectations
- Place frontend tests in `apps/dashboard/tests` or co-located test files where agreed.
- Run targeted tests for changed areas first; run broader suite before handoff.
- Add/adjust tests whenever behavior changes.

## Git & PR Workflow
- Keep commits focused by domain (UI/state/api integration).
- Reference the relevant planning docs in commit/PR description (`plan/mvp/*`).
- Request review for auth/permission-sensitive UI changes.

## Safety / Guardrails
- Request confirmation before destructive commands (e.g. deleting app folders, force reset).
- Never commit secrets, tokens, or `.env` values.
- Prefer reversible edits and small incremental commits.
