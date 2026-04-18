from __future__ import annotations

from kuuna_backend.domain.auth.service import (
    hash_password,
    password_policy_violations,
    verify_password,
)


def test_hash_and_verify_roundtrip() -> None:
    pw = "SuperSecret99!!"
    encoded = hash_password(pw)
    assert verify_password(pw, encoded) is True


def test_verify_password_returns_false_for_wrong_password() -> None:
    encoded = hash_password("SuperSecret99!!")
    assert verify_password("WrongPassword1!", encoded) is False


def test_verify_password_returns_false_for_malformed_hash() -> None:
    assert verify_password("anything", "notahash") is False
    assert verify_password("anything", "a$b$c") is False


def test_different_hashes_for_same_password() -> None:
    """Each hash call produces a different salt, so hashes differ."""
    pw = "SuperSecret99!!"
    h1 = hash_password(pw)
    h2 = hash_password(pw)
    assert h1 != h2
    assert verify_password(pw, h1) is True
    assert verify_password(pw, h2) is True


def test_password_policy_no_violations_for_valid_password() -> None:
    violations = password_policy_violations("SuperSecret99!!")
    assert violations == []


def test_password_policy_too_short() -> None:
    # default min length is 12
    violations = password_policy_violations("Short1!")
    assert any("minimum length" in v for v in violations)


def test_password_policy_no_uppercase() -> None:
    violations = password_policy_violations("alllowercase99!!")
    assert any("uppercase" in v for v in violations)


def test_password_policy_no_lowercase() -> None:
    violations = password_policy_violations("ALLUPPER99!!")
    assert any("lowercase" in v for v in violations)


def test_password_policy_no_digit() -> None:
    violations = password_policy_violations("NoDigitsHere!!")
    assert any("digit" in v for v in violations)


def test_password_policy_no_symbol() -> None:
    violations = password_policy_violations("NoSymbolsHere99")
    assert any("symbol" in v for v in violations)


def test_password_policy_multiple_violations_for_trivial_password() -> None:
    # "short" has: too short, no uppercase, no digit, no symbol
    violations = password_policy_violations("short")
    assert len(violations) >= 3
