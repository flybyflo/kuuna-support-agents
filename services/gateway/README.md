# Gateway Scaffold

WhatsApp gateway adapter scaffold (ingest/dispatch transport layer).

## Raw Event Persistence Rule

When mapping Neonize events, include the full provider event payload as `raw_event` in the backend inbound contract.
This payload is stored in Postgres (`message_versions.raw_event` JSONB) for audit/debug/replay.

## Neonize Hook

`src/neonize_bridge.py` wires Neonize callbacks:
- `ConnectedEv` -> gateway connected log
- `MessageEv` -> map event -> POST `/gateway/inbound`

Entry point: `src/app.py`

Environment variables:
- `GATEWAY_SESSION_NAME` (default `kuuna-gateway`)
- `BACKEND_BASE_URL` (default `http://backend:8000`)
- `GATEWAY_SERVICE_TOKEN` (optional)
- `NEONIZE_DATABASE_PATH` (default `./neonize.db`)
