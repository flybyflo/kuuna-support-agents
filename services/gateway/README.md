# Gateway

TypeScript WhatsApp gateway using Baileys for ingest, outbound dispatch, and ops endpoints.

## Raw Event Persistence Rule

When mapping Baileys events, include the full provider event payload as `raw_event` in the backend inbound contract.
This payload is stored in Postgres (`message_versions.raw_event` JSONB) for audit/debug/replay.

The backend provider literal intentionally remains `whatsapp-neonize` for compatibility with existing contracts and data.

## Baileys Hook

`src/baileys-gateway.ts` wires Baileys events:
- `connection.update` -> connection status and QR cache
- `creds.update` -> persisted auth state
- `messages.upsert` -> map event -> POST `/gateway/inbound`

Entry point: `src/server.ts`

Environment variables:
- `GATEWAY_SESSION_NAME` (default `kuuna-gateway`)
- `BACKEND_BASE_URL` (default `http://backend:8000`)
- `GATEWAY_SERVICE_TOKEN` (optional)
- `BAILEYS_AUTH_DIR` (default `/data/baileys-auth` in Docker)

## Sentry

- Sentry project: `kuuna-gateway`
- Default CLI config in `services/gateway/.sentryclirc`
- DSN env var in `infra/env/gateway.env.example` (`SENTRY_DSN`)

For Docker dev, bind-mount source code and keep Baileys auth/session data on a persistent named volume (`gateway_session` -> `/data`).

## Pairing After Neonize

Neonize auth data cannot be reused by Baileys. If `/data/neonize.db` exists but
`BAILEYS_AUTH_DIR` does not contain Baileys credentials yet, the gateway logs a
`gateway_legacy_neonize_session_detected` warning and waits for a fresh WhatsApp
Linked Devices pairing.

When Baileys emits a QR code, the gateway stores it for `GET /ops/qr` and prints
a scannable terminal QR to the container logs by default. Set
`GATEWAY_PRINT_QR=false` to disable log rendering.
