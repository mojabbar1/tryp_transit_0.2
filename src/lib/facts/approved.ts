import 'server-only';
import type { CitationRef } from '@/lib/contracts/transit-insights';
import { type AgentCitation, type AgentFact, getAssumptions } from '@/lib/api/data-agent';
import { assumptions } from '@/lib/domain/assumptions';
import type { CostValues } from '@/lib/domain/cost';
import type { ServerEnv } from '@/lib/env';

/**
 * Approved facts for the web app (P4b): the data agent's /v1/assumptions first, and the approved 05 §2 values in
 * assumptions.ts only as a flagged fallback (`origin: "local_fallback"`, plus a degraded code). Nothing here
 * approves, promotes, or invents a value: a key neither source has stays missing.
 */

export type FactOrigin = 'data_agent' | 'local_fallback';

export interface ApprovedFact {
  key: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  origin: FactOrigin;
  citations: CitationRef[];
}

export interface ApprovedFacts {
  facts: Partial<Record<string, ApprovedFact>>;
  missing: string[];
  degraded: string[];
}

// Plausibility guards (engineering bounds, not facts): a value outside them is treated as unusable, so a unit
// slip in the store (cents for dollars, kg for g) falls back instead of reaching a rider.
const BOUNDS: Record<string, readonly [number, number]> = {
  'drive.fuel_price_usd_per_gal': [0.01, 20],
  'drive.mpg': [1, 200],
  'drive.maintenance_usd_per_mile': [0, 5],
  'drive.total_cost_usd_per_mile': [0.01, 10],
  'parking.downtown_usd': [0, 500],
  'transit.base_fare_usd': [0, 50],
  'transit.access_buffer_min': [0, 120],
  'co2.car_g_per_mile': [1, 5000],
  'co2.car_occupancy': [0.1, 10],
  'co2.bus_g_per_passenger_mile': [0, 5000],
};

export const COST_FACT_KEYS = [
  'cost.basis',
  'drive.fuel_price_usd_per_gal',
  'drive.mpg',
  'drive.maintenance_usd_per_mile',
  'transit.base_fare_usd',
] as const;

const httpUrl = (value: string | undefined) => (value && /^https?:\/\//i.test(value) ? value : undefined);
const isoDate = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);

export function citationFromAgent(citation: AgentCitation, ref: string): CitationRef {
  const retrieved = isoDate(citation.retrieved);
  return {
    ref,
    ...(citation.source_id ? { sourceId: citation.source_id } : {}),
    ...(citation.attribution ? { attribution: citation.attribution } : {}),
    ...(retrieved ? { retrieved } : {}),
    ...(typeof citation.fact_id === 'number' ? { factId: citation.fact_id } : {}),
  };
}

function fromAgent(key: string, fact: AgentFact): ApprovedFact | null {
  if (fact.status !== 'approved') return null;
  const bounds = BOUNDS[key];
  if (bounds) {
    if (fact.value_num === null || fact.value_num < bounds[0] || fact.value_num > bounds[1]) return null;
  } else if (fact.value_num === null && !fact.value_text) {
    return null;
  }
  const citations = fact.sources.length
    ? fact.sources.map((source) => citationFromAgent(
      { source_id: source.source_id, attribution: source.attribution, retrieved: source.retrieved, fact_id: fact.id },
      key,
    ))
    : [{ ref: key, factId: fact.id }];
  return { key, valueNum: fact.value_num, valueText: fact.value_text, unit: fact.unit, origin: 'data_agent', citations };
}

function fromLocal(key: string): ApprovedFact | null {
  if (!Object.prototype.hasOwnProperty.call(assumptions, key)) return null;
  const entry = assumptions[key as keyof typeof assumptions];
  const value: unknown = entry.value;
  const url = httpUrl(entry.source.url);
  const retrieved = isoDate(entry.source.retrieved);
  return {
    key,
    valueNum: typeof value === 'number' ? value : null,
    valueText: typeof value === 'string' ? value : null,
    unit: entry.unit,
    origin: 'local_fallback',
    citations: [{ ref: key, attribution: entry.source.name, ...(url ? { url } : {}), ...(retrieved ? { retrieved } : {}) }],
  };
}

/** The requested keys, each from the store when it has a usable approved fact, else from the flagged fallback. */
export async function getApprovedFacts(
  env: Pick<ServerEnv, 'dataAgentEnabled' | 'dataAgentBaseUrl'>,
  keys: readonly string[],
): Promise<ApprovedFacts> {
  const result = await getAssumptions(env);
  const agentFacts = new Map<string, AgentFact>(result.ok ? result.data.items.map((item) => [item.key, item.fact]) : []);
  const facts: ApprovedFacts['facts'] = {};
  const missing: string[] = [];
  const degraded = new Set<string>();
  if (!result.ok) degraded.add('data_agent_unavailable');
  for (const key of keys) {
    const agentFact = agentFacts.get(key);
    const fact = (agentFact && fromAgent(key, agentFact)) || fromLocal(key);
    if (!fact) {
      missing.push(key);
      continue;
    }
    if (fact.origin === 'local_fallback') degraded.add('assumptions_local_fallback');
    facts[key] = fact;
  }
  return { facts, missing, degraded: [...degraded] };
}

/** The cost model's inputs, or null when any is missing (cost is then omitted, never guessed). */
export function costValuesFrom(facts: ApprovedFacts['facts']): CostValues | null {
  const basis = facts['cost.basis'];
  const num = (key: string) => facts[key]?.valueNum ?? null;
  const fuelPriceUsdPerGal = num('drive.fuel_price_usd_per_gal');
  const mpg = num('drive.mpg');
  const maintenanceUsdPerMile = num('drive.maintenance_usd_per_mile');
  const baseFareUsd = num('transit.base_fare_usd');
  // The per-trip model is marginal cost (05 §2 `cost.basis`); any other basis would mislabel the figure.
  if (!basis || !/marginal/i.test(basis.valueText ?? '')) return null;
  if (fuelPriceUsdPerGal === null || mpg === null || maintenanceUsdPerMile === null || baseFareUsd === null) return null;
  return { fuelPriceUsdPerGal, mpg, maintenanceUsdPerMile, baseFareUsd };
}
