# Tryp data agent (`tda`)

The provenance-first data service behind Tryp Transit. It ingests public sources politely, keeps observations
append-only, promotes numbers to **versioned, citable facts** through human review, and serves only approved
facts through a read-only API. Design: [`docs/transit-data-agent/02-target-architecture.md`](../docs/transit-data-agent/02-target-architecture.md).

P2 is the scaffold. It has no real connectors (P3), no metrics (P4), and no LLM code (P5). Every source in
`tda/config/sources.yaml` is `proposed`, so nothing is fetched.

## Setup

Requires [uv](https://docs.astral.sh/uv/) ≥ 0.4. It installs Python 3.12 for you. The DB commands and DB tests also
need Docker with Compose v2.

```bash
cd data_agent
uv sync                      # creates .venv from uv.lock
uv run ruff check . && uv run ruff format --check .
uv run pytest -q             # DB tests skip unless TDA_TEST_DATABASE_URL is set
```
