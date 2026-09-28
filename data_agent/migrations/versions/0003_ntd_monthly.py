"""NTD monthly ridership (P3.2): the append-only ``ridership_monthly`` table and its current view.

Revision ID: 0003_ntd_monthly
Revises: 0002_gtfs_static
"""

from __future__ import annotations

from alembic import op

from tda.store.observations import drop_observation_table_ddl, observation_table_ddl

revision = "0003_ntd_monthly"
down_revision = "0002_gtfs_static"
branch_labels = None
depends_on = None

COLUMNS = [
    "ntd_id text NOT NULL",
    "mode text NOT NULL",
    "tos text NOT NULL",
    "month date NOT NULL CHECK (extract(day FROM month) = 1)",
    "agency text",
    "mode_status text",
    "upt bigint CHECK (upt >= 0)",
    "vrm numeric CHECK (vrm >= 0)",
    "vrh numeric CHECK (vrh >= 0)",
    "voms integer CHECK (voms >= 0)",
]


def upgrade() -> None:
    # observation_table_ddl also grants the reader SELECT on current_ridership_monthly (P4 reads it).
    for statement in observation_table_ddl("ridership_monthly", COLUMNS, ["ntd_id", "mode", "tos", "month"]):
        op.execute(statement)


def downgrade() -> None:
    for statement in drop_observation_table_ddl("ridership_monthly"):
        op.execute(statement)
