import { z } from 'zod';
import { CitationRefSchema } from '@/lib/contracts/transit-insights';

/**
 * The stop picker's contract (GET /api/stops), shared by the route and the client. Client-safe: no server imports.
 *
 * - `gtfs_stop`: a stop in the active GTFS feed (from the data agent, or the committed export-stops fallback). Its
 *   id is sent with the trip request, so the schedule lookup uses that exact stop.
 * - `place`: an approximate P1 location (busStopCoordinates.ts), **not** a CARTA stop. Only lat/lng are sent; the
 *   drive leg still works and the bus schedule is mapped to a nearby stop if the data agent can, or is unavailable.
 */

export const StopSourceSchema = z.enum(['data_agent', 'gtfs_fallback', 'legacy_places']);

export const StopOptionSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(['gtfs_stop', 'place']),
  id: z.string().min(1).nullable(),
  name: z.string().min(1),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  routes: z.array(z.string()),
});

export const StopsResponseSchema = z.object({
  source: StopSourceSchema,
  stops: z.array(StopOptionSchema),
  feed: z
    .object({
      sourceId: z.string(),
      label: z.string().nullable(),
      validFrom: z.string(),
      validTo: z.string(),
      attribution: z.string().nullable(),
    })
    .nullable(),
  citations: z.array(CitationRefSchema),
  degraded: z.array(z.string()),
});

export type StopSource = z.infer<typeof StopSourceSchema>;
export type StopOption = z.infer<typeof StopOptionSchema>;
export type StopsResponse = z.infer<typeof StopsResponseSchema>;

export const gtfsStopKey = (id: string) => `stop:${id}`;
export const placeKey = (name: string) => `place:${name}`;

/** What the trip request carries for a chosen option: always the point, and the stop id only for a real stop. */
export function stopRequestFields(option: StopOption): { point: { lat: number; lng: number }; stopId?: string } {
  return option.kind === 'gtfs_stop' && option.id ? { point: { lat: option.lat, lng: option.lng }, stopId: option.id } : { point: { lat: option.lat, lng: option.lng } };
}

/** Case-insensitive match on the name, id, or a route, for the picker's search box. */
export function filterStops(stops: readonly StopOption[], query: string, limit: number): StopOption[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? stops.filter((stop) =>
      stop.name.toLowerCase().includes(needle)
      || (stop.id !== null && stop.id.toLowerCase() === needle)
      || stop.routes.some((route) => route.toLowerCase() === needle))
    : stops;
  return matches.slice(0, limit);
}
