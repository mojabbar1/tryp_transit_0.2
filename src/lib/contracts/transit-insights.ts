/**
 * Contract for POST /api/transit-insights (docs/transit-data-agent/02-target-architecture.md §8.1).
 *
 * Zod is the single source of truth and the TypeScript types are inferred from it. The client and the server
 * share this module, so it must never import server-only code.
 *
 * The legacy fields keep their names and types. `comparison` and `meta` are additive and optional. The
 * refinements encode the plan's invariants so a response that breaks one fails `safeParse`:
 * - `transit.basis` is an enum, and "unavailable" carries no minutes or departures (D-21);
 * - cost and CO2 differences are signed, drive − transit, and every figure cites at least one fact;
 * - an LLM narration is served only after it passes validation (fail closed);
 * - an incentive appears only while an offer is active (D-25).
 */
import { z } from 'zod';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Degraded reasons are machine codes. Free text could carry upstream error details into the response.
const REASON_CODE = /^[a-z][a-z0-9_]*$/;

const finite = () => z.number().finite();

// One check that parses and restricts the scheme, so a bad link reports exactly one issue.
const httpUrl = z.string().refine(
  (value) => {
    try {
      return /^https?:$/.test(new URL(value).protocol);
    } catch {
      return false;
    }
  },
  { message: 'Expected an http(s) URL' },
);

export const TrafficDensitySchema = z.enum(['Light', 'Medium', 'Heavy']);

export const LatLngSchema = z.object({
  lat: finite().min(-90).max(90),
  lng: finite().min(-180).max(180),
});

export const TransitInsightRequestSchema = z.object({
  departure: LatLngSchema,
  destination: LatLngSchema,
  timeToDestination: z.string().regex(HHMM, 'Expected HH:MM (24-hour)'),
});

export const IncentiveDetailsSchema = z.object({
  type: z.enum(['eCredit', 'partnerDiscount', 'funReward']),
  description: z.string(),
  value: z.string(),
});

export const AdditionalRideSchema = z.object({
  departureTime: z.string().regex(HHMM, 'Expected HH:MM (24-hour)').optional(),
  travelTime: finite().nonnegative(),
  trafficDensity: TrafficDensitySchema,
});

export const SourceRefSchema = z.object({
  name: z.string().min(1),
  url: httpUrl.optional(),
  retrieved: z.union([z.string().date(), z.string().datetime({ offset: true })]).optional(),
});

export const TransitBasisSchema = z.enum(['unavailable', 'scheduled', 'realtime']);

const DriveLegSchema = z.object({
  minutes: finite().nonnegative(),
  delayMinutes: finite().nonnegative(),
  source: SourceRefSchema,
});

const TransitLegSchema = z
  .object({
    minutes: finite().nonnegative().nullable(),
    basis: TransitBasisSchema,
    nextDepartures: z.array(z.string().min(1)),
    source: SourceRefSchema,
  })
  .superRefine((leg, ctx) => {
    if (leg.basis === 'unavailable') {
      if (leg.minutes !== null) {
        ctx.addIssue({ code: 'custom', path: ['minutes'], message: 'minutes must be null when basis is "unavailable" (D-21)' });
      }
      if (leg.nextDepartures.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['nextDepartures'], message: 'nextDepartures must be empty when basis is "unavailable" (D-21)' });
      }
    } else if (leg.minutes === null) {
      ctx.addIssue({ code: 'custom', path: ['minutes'], message: `minutes is required when basis is "${leg.basis}"` });
    }
  });

/** drive, transit and a signed difference (drive − transit), compared at `scale` units per value to absorb float noise. */
function signedComparison(scale: number, unit: string) {
  return z
    .object({
      drive: finite().nonnegative(),
      transit: finite().nonnegative(),
      difference: finite(),
      factRefs: z.array(z.string().min(1)).min(1),
    })
    .superRefine((value, ctx) => {
      const expected = Math.round(value.drive * scale) - Math.round(value.transit * scale);
      if (Math.round(value.difference * scale) !== expected) {
        ctx.addIssue({
          code: 'custom',
          path: ['difference'],
          message: `difference must be drive − transit, signed (checked in ${unit}); negative means transit costs more`,
        });
      }
    });
}

export const CostComparisonSchema = signedComparison(100, 'cents');
export const Co2ComparisonSchema = signedComparison(1000, 'grams');

export const ComparisonSchema = z.object({
  drive: DriveLegSchema,
  transit: TransitLegSchema,
  costUsd: CostComparisonSchema.optional(),
  co2Kg: Co2ComparisonSchema.optional(),
});

export const NarrationSchema = z
  .object({
    source: z.enum(['template', 'llm']),
    provider: z.enum(['gemini', 'openai', 'template']),
    model: z.string().min(1).optional(),
    validated: z.boolean(),
  })
  .superRefine((narration, ctx) => {
    if (narration.source === 'llm') {
      if (narration.provider === 'template') {
        ctx.addIssue({ code: 'custom', path: ['provider'], message: 'an LLM narration names its provider' });
      }
      if (!narration.validated) {
        ctx.addIssue({ code: 'custom', path: ['validated'], message: 'an LLM narration is served only after it passes validation' });
      }
    } else if (narration.validated) {
      ctx.addIssue({ code: 'custom', path: ['validated'], message: 'validated is true only for a served LLM narration' });
    }
    if (narration.provider === 'template' && narration.model !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['model'], message: 'the template has no model' });
    }
  });

export const MetaSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  region: z.string().min(1),
  timezone: z.string().min(1),
  demo: z.boolean(),
  offerActive: z.boolean(),
  narration: NarrationSchema,
  degraded: z.array(z.string().regex(REASON_CODE, 'Expected a snake_case reason code')),
  citations: z.array(z.string().min(1)),
});

export const TransitInsightResponseSchema = z
  .object({
    travelTime: finite().nonnegative().nullable(),
    trafficDensity: TrafficDensitySchema.nullable(),
    costSavingsPerTrip: z.string().nullable(),
    nudgeMessage: z.string().nullable(),
    incentiveDetails: IncentiveDetailsSchema.nullable(),
    additionalRides: z.array(AdditionalRideSchema).nullable(),
    comparison: ComparisonSchema.optional(),
    meta: MetaSchema.optional(),
  })
  .superRefine((response, ctx) => {
    if (response.comparison?.transit.basis === 'unavailable') {
      if (response.travelTime !== null) {
        ctx.addIssue({ code: 'custom', path: ['travelTime'], message: 'travelTime must be null while transit timing is unavailable (D-21)' });
      }
      if (response.additionalRides !== null && response.additionalRides.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['additionalRides'], message: 'additionalRides must be empty while transit timing is unavailable (D-21)' });
      }
    }
    if (response.meta && response.incentiveDetails !== null && !response.meta.offerActive) {
      ctx.addIssue({ code: 'custom', path: ['incentiveDetails'], message: 'incentiveDetails is present only while meta.offerActive is true (D-25)' });
    }
  });

export type TrafficDensity = z.infer<typeof TrafficDensitySchema>;
export type LatLng = z.infer<typeof LatLngSchema>;
export type TransitInsightRequest = z.infer<typeof TransitInsightRequestSchema>;
export type IncentiveDetails = z.infer<typeof IncentiveDetailsSchema>;
export type AdditionalRide = z.infer<typeof AdditionalRideSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type TransitBasis = z.infer<typeof TransitBasisSchema>;
export type Comparison = z.infer<typeof ComparisonSchema>;
export type Narration = z.infer<typeof NarrationSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type TransitInsightResponse = z.infer<typeof TransitInsightResponseSchema>;
