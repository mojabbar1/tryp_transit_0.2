"""EIA weekly retail gasoline prices (P3.4): the append-only ``fuel_price_weekly`` table and its current view.

Revision ID: 0005_eia_gas
Revises: 0004_gtfs_rt_alerts
"""

from __future__ import annotations

from alembic import op

from tda.store.observations import drop_observation_table_ddl, observation_table_ddl

revision = "0005_eia_gas"
down_revision = "0004_gtfs_rt_alerts"
branch_labels = None
depends_on = None

COLUMNS = [
    "series_id text NOT NULL",
    # EIA dates each weekly price by its Monday.
    "week date NOT NULL CHECK (extract(isodow FROM week) = 1)",
    "usd_per_gal numeric(6, 3) NOT NULL CHECK (usd_per_gal > 0)",
]


def upgrade() -> None:
    # observation_table_ddl also grants the reader SELECT on current_fuel_price_weekly (P4 reads it).
    for statement in observation_table_ddl("fuel_price_weekly", COLUMNS, ["series_id", "week"]):
        op.execute(statement)


def downgrade() -> None:
    for statement in drop_observation_table_ddl("fuel_price_weekly"):
        op.execute(statement)
