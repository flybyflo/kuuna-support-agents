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

Cutover gate now focuses on live Docker smoke coverage. The TypeScript service satisfies the
mirrored Staff API, Gateway REST API, internal Ops API, and worker contract subsets that currently
exist in `services/backend-ts/tests`.

Current TypeScript parity status:

- Auth token/password primitives are covered by TS unit tests.
- Auth login/me, user create/hard-delete, and internal admin bootstrap contracts are mirrored in TS
  contract tests.
- Trigger decision logic is covered by TS unit tests.
- Drizzle schema is aligned to the current Python SQLAlchemy model names for auth, runtime,
  messages, media, knowledge, outbound, agent state, retrieval chunks, and links.
- tRPC has functional mutations for templates, template versions, tools, users, bindings,
  and knowledge lifecycle.
- Gateway REST persists messages, versions, media, decisions, links, and outbound statuses, with
  inbound accept/dedupe and outbound status covered by TS contract tests.
- BullMQ worker entry is now the default Compose `worker`. `knowledge_indexing`,
  `retrieval_indexing`, `outbound_dispatch`, `todo_export`, `template_build`, `media_processing`,
  `passive_message_analysis`, and `inbound_execution` have functional TS paths covered by TS
  contract tests.
- Ingested knowledge read models are available through tRPC and covered for common and group docs.
- Internal template-build, media-reconcile, and runtime-run Ops endpoints are implemented in TS.
- Dashboard auth now uses backend `auth.login` through tRPC and stores the backend token in an
  encrypted httpOnly cookie. Regular dashboard data paths no longer import direct Postgres
  repositories.
- Compose now runs TS as `backend` on port 8000, uses a TS/Drizzle `migrate` task, and keeps
  Python backend/worker services under the `legacy-python-backend` profile.

Remaining live-verification gates:

- Run the TS-only Docker smoke for `login -> template -> build -> bind -> ingest -> media ->
  retrieval -> runtime -> outbound -> trace`.
- Exercise runtime provisioning against the Docker socket.
- Keep new schema changes on the TS/Drizzle migration path.

Run the Postgres-backed TS contract subset with:

```bash
BACKEND_TS_CONTRACT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/kuuna \
  npm run test --workspace @kuuna/backend-ts
```
