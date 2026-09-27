"""The client-side SCRAM-SHA-256 verifier matches the RFC 7677 test vector (password "pencil")."""

from __future__ import annotations

import base64
import hashlib
import hmac

import pytest

from tda.store.bootstrap import BootstrapError, scram_sha256_verifier

SALT = "W22ZaJ0SNY7soEsUEjb6gQ=="
CLIENT_FIRST_BARE = "n=user,r=rOprNGfwEbeRWgbNEkqO"
SERVER_FIRST = f"r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s={SALT},i=4096"
CLIENT_FINAL_NO_PROOF = "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0"
CLIENT_PROOF = "dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ="
SERVER_SIGNATURE = "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4="


def test_verifier_authenticates_the_rfc_7677_exchange() -> None:
    verifier = scram_sha256_verifier("pencil", salt=base64.b64decode(SALT))
    mechanism, rest = verifier.split("$", 1)
    params, keys = rest.split("$")
    iterations, salt = params.split(":")
    stored_key, server_key = (base64.b64decode(k) for k in keys.split(":"))
    assert (mechanism, iterations, salt) == ("SCRAM-SHA-256", "4096", SALT)

    # What a server does with the stored verifier (RFC 5802 §3).
    auth_message = f"{CLIENT_FIRST_BARE},{SERVER_FIRST},{CLIENT_FINAL_NO_PROOF}".encode()
    client_signature = hmac.new(stored_key, auth_message, hashlib.sha256).digest()
    client_key = bytes(a ^ b for a, b in zip(base64.b64decode(CLIENT_PROOF), client_signature, strict=True))
    assert hashlib.sha256(client_key).digest() == stored_key
    server_signature = hmac.new(server_key, auth_message, hashlib.sha256).digest()
    assert base64.b64encode(server_signature).decode() == SERVER_SIGNATURE


def test_verifier_uses_a_fresh_salt_and_never_contains_the_password() -> None:
    first, second = scram_sha256_verifier("correct-horse"), scram_sha256_verifier("correct-horse")
    assert first != second
    assert "correct-horse" not in first


def test_non_ascii_passwords_are_refused() -> None:
    with pytest.raises(BootstrapError, match="ASCII"):
        scram_sha256_verifier("pässword")
