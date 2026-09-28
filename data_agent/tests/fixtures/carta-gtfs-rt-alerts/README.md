# carta-gtfs-rt-alerts fixtures

The tests build synthetic GTFS-realtime `FeedMessage`s in code (`tests/connectors/rt_feed.py`), with route
and stop IDs from the synthetic GTFS feed in `../carta-gtfs/`. No real feed is committed: S-2's registry-only
licence doesn't cover redistributing the raw feed (05 §6a). The live feed had no active alerts when it was
checked on 2026-09-28, just a 15-byte header.
