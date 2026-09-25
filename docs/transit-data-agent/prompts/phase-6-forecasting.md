# Phase 6 — Forecasting on real Charleston data (execution prompt)

> **How to use:** once **P4b** is merged (P4a provides the `/v1/series/*` endpoints this phase consumes) and
> Phase 6 is signed off in [05](../05-decisions-and-review.md), paste this whole file into your coding agent.
> It's parallel-safe with P5, which touches only `data_agent/tda/agent`.
> **Plan:** [04 §Phase 6](../04-implementation-plan.md#phase-6--forecasting-on-real-data-after-p4b-parallel-safe-with-p5) ·
> **Fixes:** F-07, F-15

---

## Role and mode

You're a senior ML engineer replacing a forecast that isn't meaningful with **deterministic, backtested, honest**
ones built on Charleston data. Prefer simple models that beat a seasonal-naive baseline. **Stop and ask** if
there's too little data to backtest.

## Preconditions

- [ ] P4b is merged, so `/v1/series/ridership/monthly` and `/v1/series/traffic/hourly` exist, and the v2 engine is
      stable. `ridership_monthly` holds CARTA data, which needs ≥ 36 months for a seasonal model. You're on
      `feat/tda-phase-6-forecasting`.
- [ ] 05 sign-off records **D-10** (keep `model_service` separate and retarget it; the default) and **D-22** (the
      model backend; the default is statistical, with Chronos-Bolt optional).

## Facts (verified 2026-09-24; re-check at execution time)

- Python 3.9 has been EOL since 2025-10-31. Current numpy needs ≥ 3.12, pandas ≥ 3.11, torch ≥ 3.10.
- `chronos-forecasting` 2.x needs Python ≥ 3.10. Chronos-Bolt is CPU-friendly, and Chronos-2 is the newest family.
  The repo's `chronos-t5-mini` is two generations old.

## Tasks

1. **Image and dependencies:**
   - A `python:3.12-slim` base, a non-root user, and a `.dockerignore`.
   - Pinned dependencies (Flask or FastAPI to match the data agent: **pick one and note it in the PR**; gunicorn
     or uvicorn; pandas; numpy; statsmodels; httpx).
   - The optional extra `[chronos]` pulls in CPU torch and `chronos-forecasting>=2`.
   - Listen on port 5001.
2. **Data access:** consume the P4a endpoints `GET /v1/series/ridership/monthly?mode=` and
   `GET /v1/series/traffic/hourly?station_id=|corridor_id=` over HTTP, with timeouts. `model_service` gets **no DB
   credentials**. **Don't change the data-agent API or the OpenAPI snapshot in this phase.** If an endpoint is
   missing or wrong, stop and raise it as a P4a follow-up.
   The only data-agent change allowed here is a dev-only CLI command, `tda dev seed <fixture>`, which loads a named
   test fixture (for example `ntd_monthly`) into the local DB for verification.
3. **Models (`model_service/forecast/`):**
   - `ridership.py`: forecast monthly UPT for 1–12 months ahead. Candidates: seasonal-naive, ETS
     (`statsmodels` ExponentialSmoothing with seasonal=12), and Chronos-Bolt if `MODEL_BACKEND=chronos-bolt`.
     Pick the winner by rolling-origin backtest (MAPE), and output a point estimate plus an 80% interval.
   - `volume.py`: a typical hourly volume profile and a volume index (0–1, relative to the daily peak) by corridor
     or station and day type.
   - Keep it **deterministic**: identical inputs give identical outputs, with no unseeded randomness anywhere.
4. **API v2:**
   - `GET /v2/forecast/ridership/monthly?mode=MB&months=6` → `{ points:[{month,value,lo80,hi80}],
     model:{name,version,trained_on:{start,end},backtest_mape} }`
   - `GET /v2/forecast/volume?corridor_id=&day_type=&hour=` → `{ volume_index, typical_volume, model }`
   - `GET /health` includes the model and data freshness.
   - `/predict/*` stays for one release under `MODEL_MODE=demo` only, with a `Deprecation` header. It's seeded and
     deterministic.
5. **Web, in the same PR:**
   - Update `src/lib/api/ridership.ts` to use `/v2/forecast/volume` for time-of-day congestion context.
   - **Remove** the "predicted bus passenger count" claim from narration facts; that NYC number was never meaningful.
   - Add a `volume_index` fact, with its citation back to S-6c.
6. **Clean up:** delete `model_service/data/MTA_*.csv`, `bus_hourly_chronos_t5_tiny.py`,
   `bus_daily_chronos_t5_tiny.py`, and the dead `predict_chronos`. Rewrite `model_service/README.md`.
7. **Compose:** `model-service` depends on `data-agent-api`.

## Tests

- Backtest on a fixture series: the chosen model's MAPE is ≤ seasonal-naive MAPE. The test asserts the model
  selection logic, not a magic number.
- Determinism: run twice and get identical JSON.
- API contract tests.
- With too little data, the endpoint returns a `422` with a clear reason instead of a fake forecast.
- Web ridership-client tests are updated.

## Verification (paste the output into the PR)

```bash
(cd model_service && uv run pytest -q)   # or: python -m pytest -q
docker compose up -d --build postgres data-agent-api model-service && sleep 5
(cd data_agent && uv run tda db upgrade && uv run tda dev seed ntd_monthly)   # known fixture series
curl -s localhost:5001/health | jq .
curl -s "localhost:5001/v2/forecast/ridership/monthly?mode=MB&months=6" | jq '.model, (.points|length)'   # expect 6 points
docker compose down
(cd src && npm test -- --ci && npm run build)
```

In compose, `model-service` reaches the data agent at `http://data-agent-api:8081`, set through env.

## Definition of done

- [ ] No NYC data or random mock remains in the default mode (`grep -rn "MTA_\|np.random" model_service` returns
      nothing outside the demo module).
- [ ] The image runs on Python 3.12, as non-root, on port 5001.
- [ ] The backtest report (MAPE per candidate) is in the PR.

## Rollback

Keep the previous image tag, and the v1 endpoints stay for one release under `MODEL_MODE=demo`. Revert the PR if
needed.

## Handoff

In [../README.md](../README.md), set P6 to Done. Note the data volume needed before trying Chronos-2 with
covariates (for example, weather or tide).
