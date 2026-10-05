import type { CitationRef } from '@/lib/contracts/transit-insights';

/** One rendered footnote: what it backs, who to credit (the source's attribution text), and an optional link. */
export interface Footnote {
  id: string;
  label: string;
  attribution: string | null;
  retrieved: string | null;
  url: string | null;
}

const LABELS: Record<string, string> = {
  'cost.basis': 'Cost basis (marginal cost per trip)',
  'drive.fuel_price_usd_per_gal': 'Gasoline price',
  'drive.mpg': 'Average fuel economy',
  'drive.maintenance_usd_per_mile': 'Maintenance, repair and tires per mile',
  'drive.total_cost_usd_per_mile': 'Total cost to own and operate per mile',
  'parking.downtown_usd': 'Downtown garage parking',
  'transit.base_fare_usd': 'CARTA base fare',
  'transit.access_buffer_min': 'Walk-to-stop buffer',
  'co2.car_g_per_mile': 'Car CO2 per mile',
  'co2.car_occupancy': 'Car occupancy',
  'co2.bus_g_per_passenger_mile': 'Bus CO2 per passenger-mile',
  'gtfs.schedule': 'Bus schedule',
  'gtfs.stops': 'Bus stops',
  'gtfs.stops.fallback': 'Bus stops (saved export)',
  'gtfs_rt.alerts': 'Service alerts',
};

/** A readable label for a fact key or citation ref; unknown refs are shown as-is rather than guessed. */
export function citationLabel(ref: string): string {
  return LABELS[ref] ?? ref;
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const clean = (value: string | undefined) => {
  const text = value?.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return text ? text : null;
};

/**
 * Footnotes for structured citations, plus any cited key that has no structured source. Duplicates (same ref,
 * source and attribution) collapse to one; only http(s) links survive; order follows first appearance.
 */
export function buildFootnotes(sources: readonly CitationRef[] = [], keys: readonly string[] = []): Footnote[] {
  const notes: Footnote[] = [];
  const seen = new Set<string>();
  const covered = new Set<string>();
  for (const source of sources) {
    const attribution = clean(source.attribution);
    const id = `${source.ref}|${source.sourceId ?? ''}|${attribution ?? ''}`;
    covered.add(source.ref);
    if (seen.has(id)) continue;
    seen.add(id);
    notes.push({ id, label: citationLabel(source.ref), attribution, retrieved: source.retrieved ?? null, url: safeHttpUrl(source.url) });
  }
  for (const key of keys) {
    if (covered.has(key) || seen.has(key)) continue;
    seen.add(key);
    notes.push({ id: key, label: citationLabel(key), attribution: null, retrieved: null, url: null });
  }
  return notes;
}
