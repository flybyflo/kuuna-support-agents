from __future__ import annotations

from kuuna_backend.api.deps import _apply_rls_session_context


class _FakeBind:
    class dialect:  # noqa: D106
        name = "postgresql"


class _FakeSession:
    def __init__(self) -> None:
        self.calls: list[tuple[object, dict[str, str]]] = []

    def get_bind(self) -> _FakeBind:
        return _FakeBind()

    def execute(self, statement: object, params: dict[str, str]) -> None:
        self.calls.append((statement, params))


def test_apply_rls_session_context_sets_role_and_scope() -> None:
    db = _FakeSession()

    _apply_rls_session_context(
        db,  # type: ignore[arg-type]
        payload={"sub": "u", "role": "operator", "group_scope": ["a", "b"], "iat": 1, "exp": 2},
    )

    assert len(db.calls) == 1
    _, params = db.calls[0]
    assert params["role"] == "operator"
    assert params["group_scope"] == "a,b"
