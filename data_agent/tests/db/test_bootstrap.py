"""Bootstrap hardening: role passwords travel as SCRAM verifiers; a foreign-owned schema is refused."""

from __future__ import annotations

import pytest
from psycopg import sql
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from tda.store.bootstrap import BootstrapError, bootstrap, scram_sha256_verifier
from tda.store.db import sqlalchemy_url
from tests.conftest import DbUrls

SCRATCH_DB = "tda_bootstrap_probe"


def test_postgres_stores_the_client_side_verifier_verbatim(db: DbUrls) -> None:
    verifier = scram_sha256_verifier("probe-password")
    engine = create_engine(sqlalchemy_url(db.admin), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            cursor = connection.connection.driver_connection.cursor()
            try:
                cursor.execute(
                    sql.SQL("CREATE ROLE tda_probe LOGIN PASSWORD {}").format(sql.Literal(verifier))
                )
                stored = connection.execute(
                    text("SELECT rolpassword FROM pg_authid WHERE rolname = 'tda_probe'")
                ).scalar_one()
            finally:
                cursor.execute("DROP ROLE IF EXISTS tda_probe")
    finally:
        engine.dispose()
    # Stored as sent: Postgres recognized a verifier and did not hash it again as a plaintext password.
    assert stored == verifier


def test_bootstrap_refuses_a_schema_owned_by_someone_else(db: DbUrls) -> None:
    admin = create_engine(sqlalchemy_url(db.admin), isolation_level="AUTOCOMMIT")
    scratch = make_url(db.admin).set(database=SCRATCH_DB).render_as_string(hide_password=False)
    with admin.connect() as connection:
        connection.execute(text(f"DROP DATABASE IF EXISTS {SCRATCH_DB} WITH (FORCE)"))
        connection.execute(text(f"CREATE DATABASE {SCRATCH_DB}"))
    try:
        other = create_engine(sqlalchemy_url(scratch), isolation_level="AUTOCOMMIT")
        with other.connect() as connection:
            connection.execute(text("CREATE SCHEMA tda"))
        other.dispose()
        with pytest.raises(BootstrapError, match="already exists and is owned by"):
            bootstrap(scratch, db.writer, db.reader)
    finally:
        with admin.connect() as connection:
            connection.execute(text(f"DROP DATABASE IF EXISTS {SCRATCH_DB} WITH (FORCE)"))
        admin.dispose()
