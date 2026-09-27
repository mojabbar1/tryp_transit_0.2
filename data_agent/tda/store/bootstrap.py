"""``tda db bootstrap``: roles, schema, and base grants, run before migrations (02 §6.2). Idempotent."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from pathlib import Path

from alembic import command
from alembic.config import Config
from psycopg import sql
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from tda.store.db import sqlalchemy_url

ROLES = ("tda_owner", "tda_writer", "tda_reader")
ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


class BootstrapError(RuntimeError):
    """Bootstrap can't proceed; the message says what a human must do."""


def scram_sha256_verifier(password: str, *, salt: bytes | None = None, iterations: int = 4096) -> str:
    """The SCRAM-SHA-256 verifier Postgres stores (RFC 5802/7677), computed client-side.

    ``CREATE ROLE ... PASSWORD`` then carries only the verifier, so the plaintext can't reach server logs.
    """
    if not password.isascii():
        raise BootstrapError("role passwords must be ASCII (SASLprep is not applied)")
    salt = salt if salt is not None else secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()

    def b64(raw: bytes) -> str:
        return base64.b64encode(raw).decode()

    return f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"


def _login_password(role: str, url: str | None) -> str | None:
    if url is None:
        return None
    parsed = make_url(url)
    if parsed.username != role:
        raise BootstrapError(f"the {role} URL must connect as {role}, not {parsed.username!r}")
    return parsed.password


def bootstrap(admin_url: str, writer_url: str | None = None, reader_url: str | None = None) -> list[str]:
    """Create missing roles (when the admin may), the ``tda`` schema, and schema-level grants.

    Role passwords are taken from the writer and reader URLs (none with trust auth) and sent only as SCRAM
    verifiers. The owner is created NOLOGIN here; compose creates it with a password via
    ``docker/postgres/init/01-roles.sql``. A pre-existing ``tda`` schema with another owner is an error.
    """
    done: list[str] = []
    engine = create_engine(sqlalchemy_url(admin_url), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            me, is_super, can_roles = connection.execute(
                text(
                    "SELECT current_user::text, rolsuper, rolsuper OR rolcreaterole "
                    "FROM pg_roles WHERE rolname = current_user"
                )
            ).one()
            existing = set(
                connection.execute(
                    text("SELECT rolname FROM pg_roles WHERE rolname = ANY(:r)"), {"r": list(ROLES)}
                )
                .scalars()
                .all()
            )
            cursor = connection.connection.driver_connection.cursor()
            urls = {"tda_owner": None, "tda_writer": writer_url, "tda_reader": reader_url}
            for role in ROLES:
                if role in existing:
                    continue
                if not can_roles:
                    raise BootstrapError(
                        f"role {role} is missing and {me} can't create roles; "
                        "run docker/postgres/init/01-roles.sql as a superuser first"
                    )
                password = _login_password(role, urls[role])
                statement = sql.SQL("CREATE ROLE {} {}").format(
                    sql.Identifier(role), sql.SQL("NOLOGIN" if role == "tda_owner" else "LOGIN")
                )
                if password:
                    statement = sql.SQL("{} PASSWORD {}").format(
                        statement, sql.Literal(scram_sha256_verifier(password))
                    )
                cursor.execute(statement)
                done.append(f"created role {role}")
            if me != "tda_owner" and not is_super:
                cursor.execute(sql.SQL("GRANT tda_owner TO {}").format(sql.Identifier(me)))
            cursor.execute("CREATE SCHEMA IF NOT EXISTS tda AUTHORIZATION tda_owner")
            schema_owner = connection.execute(
                text("SELECT pg_get_userbyid(nspowner)::text FROM pg_namespace WHERE nspname = 'tda'")
            ).scalar_one()
            if schema_owner != "tda_owner":
                raise BootstrapError(
                    f"schema tda already exists and is owned by {schema_owner!r}, not tda_owner; "
                    "fix its owner by hand (ALTER SCHEMA tda OWNER TO tda_owner) after checking why"
                )
            cursor.execute("REVOKE ALL ON SCHEMA tda FROM PUBLIC")
            cursor.execute("GRANT USAGE ON SCHEMA tda TO tda_writer, tda_reader")
            done.append("schema tda owned by tda_owner; usage granted to tda_writer and tda_reader")
    finally:
        engine.dispose()
    return done


def alembic_config(admin_url: str | None = None) -> Config:
    """Alembic config for this package; ``admin_url`` overrides TDA_ADMIN_DATABASE_URL."""
    config = Config(str(ALEMBIC_INI))
    if admin_url:
        config.set_main_option("sqlalchemy.url", sqlalchemy_url(admin_url).replace("%", "%%"))
    return config


def upgrade(admin_url: str | None = None, revision: str = "head") -> None:
    """Run ``alembic upgrade`` as tda_owner."""
    command.upgrade(alembic_config(admin_url), revision)


def downgrade(admin_url: str | None = None, revision: str = "-1") -> None:
    """Run ``alembic downgrade`` as tda_owner."""
    command.downgrade(alembic_config(admin_url), revision)
