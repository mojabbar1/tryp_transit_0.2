"""Hourly traffic-volume profiles (P4a task 3): not built yet, because their data doesn't exist.

TODO(P3.6): build the profiles once the SCDOT connector (P3.6) is signed and merged.
- **Data:** S-6c (SCDOT continuous count stations, a human export via the manual inbox) in
  docs/transit-data-agent/03-data-source-catalog.md, loaded into ``traffic_count_hourly``.
- **Corridors:** a human must first complete ``regions/charleston.yaml``; all 5 corridors are drafts with no
  probe points.
- **Profile:** the median vehicle count by hour and day type over the last N weeks. It's a count of vehicles,
  not a congestion index.
- **Stations:** the ones within X m of a corridor's probe points, for human-completed corridors only.

Until then there's no ``/v1/corridors`` endpoint, and no volume headline in ``/v1/stats``.
"""
