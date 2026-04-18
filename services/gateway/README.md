# Gateway Scaffold

WhatsApp gateway adapter scaffold (ingest/dispatch transport layer).

## Raw Event Persistence Rule

When mapping Neonize events, include the full provider event payload as `raw_event` in the backend inbound contract.
This payload is stored in Postgres (`message_versions.raw_event` JSONB) for audit/debug/replay.
