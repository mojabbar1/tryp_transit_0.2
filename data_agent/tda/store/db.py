"""Database engines. Settings carry plain ``postgresql://`` URLs; the psycopg 3 driver is added here."""

from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from tda.config.settings import Settings, get_settings


def sqlalchemy_url(url: str) -> str:
    """Convert a plain ``postgresql://`` URL into SQLAlchemy's psycopg 3 form."""
    parsed = make_url(url)
    if parsed.drivername not in ("postgresql", "postgres"):
        raise ValueError("expected a plain postgresql:// URL")
    return parsed.set(drivername="postgresql+psycopg").render_as_string(hide_password=False)


def make_engine(url: str | None, *, purpose: str, **kwargs: object) -> Engine:
    """An engine for ``url``, or a clear error naming the setting that is missing."""
    if not url:
        raise RuntimeError(f"no database URL configured for {purpose}")
    return create_engine(sqlalchemy_url(url), pool_pre_ping=True, **kwargs)


def writer_engine(settings: Settings | None = None) -> Engine:
    """Engine for ``tda_writer`` (TDA_DATABASE_URL): connectors, the worker, and the review runtime."""
    return make_engine((settings or get_settings()).database_url, purpose="the writer (TDA_DATABASE_URL)")


def reader_engine(settings: Settings | None = None) -> Engine:
    """Engine for ``tda_reader`` (TDA_READER_DATABASE_URL): the read API."""
    return make_engine(
        (settings or get_settings()).reader_database_url, purpose="the reader (TDA_READER_DATABASE_URL)"
    )


def admin_engine(settings: Settings | None = None, **kwargs: object) -> Engine:
    """Engine for bootstrap and migrations (TDA_ADMIN_DATABASE_URL: a superuser or tda_owner)."""
    return make_engine(
        (settings or get_settings()).admin_database_url,
        purpose="admin tasks (TDA_ADMIN_DATABASE_URL)",
        **kwargs,
    )


def session_factory(engine: Engine) -> sessionmaker[Session]:
    """A session factory whose objects stay readable after commit."""
    return sessionmaker(bind=engine, expire_on_commit=False)
