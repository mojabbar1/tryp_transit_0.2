// PLACEHOLDER: not generated. No real, human-approved CARTA GTFS feed has been exported yet (P4b, 2026-10-03).
// `tda gtfs export-stops --format ts` (data_agent, P4a) overwrites this file from the active feed; commit its output
// and regenerate it on every feed change. Until then the app serves no fallback stops and says so; it never
// substitutes synthetic or fixture stops (src/__tests__/data/stops-fallback.test.ts enforces both).
export type FallbackStop = { id: string; name: string; lat: number; lng: number };

export const fallbackStops: readonly FallbackStop[] = [];
