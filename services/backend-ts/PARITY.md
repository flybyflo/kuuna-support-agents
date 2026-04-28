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
