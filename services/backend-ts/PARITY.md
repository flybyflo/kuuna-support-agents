# Backend TS Parity Baseline

The Python backend remains the behavioral source of truth until cutover.

Current verified baseline:

```bash
cd backend
uv run pytest -q
```

Result after fixing the E2E smoke fixture:

```text
174 passed, 2 skipped
```

Contract suites to port or mirror for the TypeScript service:

- `backend/tests/contract/test_agent_state_contract.py`
- `backend/tests/contract/test_audit_trace_contract.py`
- `backend/tests/contract/test_auth_guards_contract.py`
- `backend/tests/contract/test_auth_users_contract.py`
- `backend/tests/contract/test_docker_smoke_contract.py`
- `backend/tests/contract/test_e2e_smoke_contract.py`
- `backend/tests/contract/test_gateway_contract.py`
- `backend/tests/contract/test_gateway_trigger_outbound_contract.py`
- `backend/tests/contract/test_knowledge_ingested_contract.py`
- `backend/tests/contract/test_templates_bindings_knowledge_contract.py`
- `backend/tests/contract/test_tools_contract.py`
- `backend/tests/contract/test_trace_contract.py`

Cutover is blocked until the TypeScript service can satisfy the Staff API, Gateway REST API,
internal Ops API, and worker behavior covered by those suites.

Current TypeScript parity status:

- Auth token/password primitives are covered by TS unit tests.
- Auth login/me and user create/hard-delete contracts are mirrored in TS contract tests.
- Trigger decision logic is covered by TS unit tests.
- Drizzle schema is aligned to the current Python SQLAlchemy model names for auth, runtime,
  messages, media, knowledge, outbound, agent state, retrieval chunks, and links.
- tRPC has functional mutations for templates, template versions, tools, users, bindings,
  and knowledge lifecycle.
- Gateway REST persists messages, versions, media, decisions, links, and outbound statuses, with
  inbound accept/dedupe and outbound status covered by TS contract tests.
- BullMQ worker entry exists behind the `backend-ts-cutover` Compose profile. `knowledge_indexing`,
  `retrieval_indexing`, `outbound_dispatch`, `todo_export`, `template_build`, `media_processing`,
  `passive_message_analysis`, and `inbound_execution` now have functional TS paths covered by TS
  contract tests. Runtime provisioning and Dashboard cutover still need final hardening before that
  profile can replace the Python RQ worker.
- Ingested knowledge read models are available through tRPC and covered for common and group docs.
- Internal template-build, media-reconcile, and runtime-run Ops endpoints are implemented in TS.

Run the Postgres-backed TS contract subset with:

```bash
BACKEND_TS_CONTRACT_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kuuna \
  npm run test --workspace @kuuna/backend-ts
```
