import 'server-only';
import { busStopCoordinates } from '@/app/data/busStopCoordinates';
import { type FallbackStop, fallbackStops } from '@/app/data/stops.fallback.generated';
import { listStops } from '@/lib/api/data-agent';
import type { ServerEnv } from '@/lib/env';
import { type StopOption, type StopsResponse, gtfsStopKey, placeKey } from './types';

/**
 * The stop picker's list (P4b), in order of preference:
 * 1. the data agent's active feed (`/v1/stops`, shared for a day; it holds no rider data);
 * 2. the committed `stops.fallback.generated.ts` from `tda gtfs export-stops`, if it holds a real export;
 * 3. the P1 approximate locations, labeled as places (not stops), so the drive leg keeps working while the bus
 *    schedule is honestly unavailable. This is the rollback path while no real export exists.
 */

// Output of the P4a test fixture feed (ids FX01..., "Fixture Stop ..."), or anything marked synthetic, is never served
// as real stops, even if someone commits it by mistake.
export function looksLikeFixture(stops: readonly FallbackStop[]): boolean {
  return stops.some((stop) => /^FX\d+$/i.test(stop.id) || /\b(fixture|synthetic|test data)\b/i.test(stop.name));
}

const validPoint = (stop: { lat: number; lng: number }) =>
  Number.isFinite(stop.lat) && Number.isFinite(stop.lng) && Math.abs(stop.lat) <= 90 && Math.abs(stop.lng) <= 180;

function fallbackOptions(stops: readonly FallbackStop[]): StopOption[] {
  return stops.filter(validPoint).map((stop) => ({
    key: gtfsStopKey(stop.id),
    kind: 'gtfs_stop',
    id: stop.id,
    name: stop.name || stop.id,
    lat: stop.lat,
    lng: stop.lng,
    routes: [],
  }));
}

function legacyPlaces(): StopOption[] {
  return Object.entries(busStopCoordinates).map(([name, point]) => ({
    key: placeKey(name),
    kind: 'place',
    id: null,
    name,
    lat: point.lat,
    lng: point.lng,
    routes: [],
  }));
}

export async function getStopCatalog(
  env: Pick<ServerEnv, 'dataAgentEnabled' | 'dataAgentBaseUrl'>,
  committedFallback: readonly FallbackStop[] = fallbackStops,
): Promise<StopsResponse> {
  const degraded: string[] = [];
  const result = await listStops(env);
  if (result.ok && result.data.items.length > 0) {
    const { feed } = result.data;
    return {
      source: 'data_agent',
      stops: result.data.items.map((stop) => ({
        key: gtfsStopKey(stop.id),
        kind: 'gtfs_stop',
        id: stop.id,
        name: stop.name ?? stop.id,
        lat: stop.lat,
        lng: stop.lng,
        routes: stop.route_short_names,
      })),
      feed: { sourceId: feed.source_id, label: feed.feed_label, validFrom: feed.feed_start, validTo: feed.feed_end, attribution: feed.attribution },
      citations: [{ ref: 'gtfs.stops', sourceId: feed.source_id, ...(feed.attribution ? { attribution: feed.attribution } : {}) }],
      degraded,
    };
  }
  degraded.push('data_agent_unavailable');

  if (committedFallback.length > 0 && !looksLikeFixture(committedFallback)) {
    return { source: 'gtfs_fallback', stops: fallbackOptions(committedFallback), feed: null, citations: [{ ref: 'gtfs.stops.fallback' }], degraded };
  }
  degraded.push(committedFallback.length > 0 ? 'stops_fallback_rejected' : 'stops_fallback_unavailable');
  return { source: 'legacy_places', stops: legacyPlaces(), feed: null, citations: [], degraded };
}
