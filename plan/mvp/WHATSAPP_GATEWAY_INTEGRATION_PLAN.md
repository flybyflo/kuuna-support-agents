# WhatsApp Gateway Integration Plan (MVP)

Base references:
- `plan/mvp/PRD.md`
- `plan/mvp/PROJECT_STRUCTURE_PLAN.md`

Scope: integration plan for the WhatsApp transport layer (`services/gateway`) and its contracts with backend routing, ingest, and outbound dispatch.

---

## 1) Objectives

1. Persist all inbound group events reliably (messages + media metadata).
2. Enforce deterministic routing by `provider_group_id` through backend binding checks.
3. Send outbound replies idempotently via `outbound_intent_id`.
4. Keep gateway logic transport-only (no business policy decisions in gateway).

---

## 2) Integration Boundaries

### Gateway owns
- Provider session lifecycle (neonize connection/session)
- Incoming webhook/event normalization to internal schema
- Outbound delivery to WhatsApp provider API
- Transport retries for temporary provider errors

### Backend owns
- Group binding validation and trigger policy (mention/reply/prefix)
- Message dedupe and event versioning
- Ingest pipeline orchestration (media/transcription/indexing)
- RAG, tool execution, failover, and response generation

---

## 3) Event Contracts (MVP)

### 3.1 Inbound event envelope

```json
{
  "trace_id": "uuid",
  "provider": "whatsapp-neonize",
  "provider_group_id": "string",
  "provider_message_id": "string",
  "sender_provider_user_id": "string",
  "event_type": "message_created|message_edited|message_deleted",
  "occurred_at": "iso8601",
  "message": {
    "text": "string|null",
    "reply_to_provider_message_id": "string|null",
    "mentions": ["string"],
    "media": [
      {
        "provider_media_id": "string",
        "mime_type": "string",
        "file_name": "string|null",
        "byte_size": 0,
        "download_url": "string|null"
      }
    ]
  }
}
```

### 3.2 Outbound intent envelope

```json
{
  "trace_id": "uuid",
  "outbound_intent_id": "uuid",
  "provider_group_id": "string",
  "reply_to_provider_message_id": "string|null",
  "text": "string",
  "metadata": {
    "agent_instance_id": "uuid",
    "model_path": ["gpt-4.1", "gpt-4.1-mini"]
  }
}
```

---

## 4) Processing Flow

1. Provider emits inbound event to gateway listener.
2. Gateway maps provider payload -> internal inbound envelope.
3. Gateway attaches `trace_id` if missing.
4. Gateway forwards envelope to backend ingest endpoint/queue.
5. Backend persists message event and stores full event payload in `message_versions.raw_event` (JSONB).
6. Backend decides trigger eligibility and, if eligible, enqueues execution.
7. Backend emits outbound intent.
8. Gateway sends outbound intent to provider using `outbound_intent_id` idempotency key.
9. Gateway reports delivery status back to backend (`sent|failed|retrying`).

---

## 5) Failure Handling

1. **Inbound transport failure**: gateway retries with bounded backoff.
2. **Backend unavailable**: gateway queues locally in memory for short window, then dead-letter log with trace.
3. **Provider outbound transient failure**: retry with same `outbound_intent_id`.
4. **Provider outbound permanent failure**: mark failed + emit structured error event.
5. **Duplicate inbound event**: backend unique constraint handles idempotency.

---

## 6) Security and Compliance (MVP)

- Gateway authenticates to backend with short-lived service token.
- Structured logs contain metadata only (no raw message bodies in warning/error logs).
- Media content retrieval URLs are treated as sensitive and not logged.

---

## 7) Implementation Phases

### Phase A — Transport skeleton
- Neonize session bootstrap
- Inbound event mapper
- Health endpoint and structured logging

### Phase B — Inbound contract wiring
- Backend ingest endpoint contract
- Trace ID propagation
- Retry semantics for 5xx/timeouts

### Phase C — Outbound idempotent dispatch
- Outbound intent consumer
- Provider send + dedupe key
- Delivery status callback/reporting

### Phase D — Hardening
- Backoff policy tuning
- Dead-letter visibility and alert hook
- Gateway smoke test scenario

---

## 8) Task Breakdown

- [ ] 1.0 Define and freeze inbound/outbound JSON contracts in `packages/contracts`
- [ ] 2.0 Implement gateway mapping layer for supported WhatsApp event types
- [ ] 3.0 Add backend ingest endpoint for gateway submissions
- [ ] 4.0 Add outbound dispatcher path using `outbound_intent_id`
- [ ] 5.0 Add retry policy + failure status reporting
- [ ] 6.0 Add gateway integration smoke test (`ingest -> route -> reply`)

---

## 9) Done Criteria

1. Inbound events are accepted and persisted for bound and unbound groups.
2. No agent response occurs for unbound groups.
3. Outbound retries never duplicate user-visible sends.
4. Every event path has a trace ID in logs.
5. Smoke scenario passes in Docker dev environment.
