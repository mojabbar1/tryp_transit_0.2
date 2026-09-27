"""Alembic environment. Migrations always run as ``tda_owner`` so every object is owned by it (02 §6.2)."""

from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine, text

from tda.config.settings import get_settings
from tda.store.db import sqlalchemy_url

config = context.config


def _admin_url() -> str:
    url = config.get_main_option("sqlalchemy.url") or get_settings().admin_database_url
    if not url:
        raise RuntimeError("TDA_ADMIN_DATABASE_URL is not set (a superuser or tda_owner URL)")
    return url if "+" in url.split("://", 1)[0] else sqlalchemy_url(url)


def run_migrations_online() -> None:
    engine = create_engine(_admin_url())
    with engine.connect() as connection:
        if connection.execute(text("SELECT current_user")).scalar_one() != "tda_owner":
            # A superuser (CI) or a member of tda_owner migrates on the owner's behalf.
            connection.execute(text("SET ROLE tda_owner"))
        connection.commit()
        context.configure(connection=connection, version_table_schema="tda", transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()
        connection.commit()
    engine.dispose()


if context.is_offline_mode():
    raise RuntimeError("offline (--sql) migrations are not supported; run against a database")
run_migrations_online()
