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
 * - an incentive appears only while `meta.offerActive` is true, so a response without `meta` can't carry one (D-25).
 */
import { z } from 'zod';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// GTFS stop ids are opaque strings; this bounds them and keeps control characters out of logs and URLs.
const STOP_ID = /^[\x21-\x7E]{1,100}$/;
// Degraded reasons are machine codes. Free text could carry upstream error details into the response.
const REASON_CODE = /^[a-z][a-z0-9_]*$/;

const finite = () => z.number().finite();
// A scheduled instant as the data agent gives it: local time with its UTC offset, so the calendar date is never lost.
const offsetDateTime = () => z.string().datetime({ offset: true });

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

export const StopIdSchema = z.string().regex(STOP_ID, 'Expected a GTFS stop id');

export const TransitInsightRequestSchema = z.object({
  departure: LatLngSchema,
  destination: LatLngSchema,
  timeToDestination: z.string().regex(HHMM, 'Expected HH:MM (24-hour)'),
  // P4b: optional GTFS stop ids from the stop picker. Without them the lat/lng map to the nearest stop.
  departureStopId: StopIdSchema.optional(),
  destinationStopId: StopIdSchema.optional(),
});

export const IncentiveDetailsSchema = z.object({
  type: z.enum(['eCredit', 'partnerDiscount', 'funReward']),
  description: z.string(),
  value: z.string(),
});

export const AdditionalRideSchema = z.object({
  departureTime: z.string().regex(HHMM, 'Expected HH:MM (24-hour)').optional(),
  travelTime: finite().nonnegative(),
  // Optional since P4b: a scheduled departure later in the day has no measured traffic, so none is invented.
  trafficDensity: TrafficDensitySchema.optional(),
  arrivalTime: z.string().regex(HHMM, 'Expected HH:MM (24-hour)').optional(),
  routeShortName: z.string().min(1).optional(),
  // P4b: the full scheduled times behind the HH:MM fields (which stay as they were), and the trip's GTFS service day.
  departureAt: offsetDateTime().optional(),
  arrivalAt: offsetDateTime().optional(),
  serviceDate: z.string().date().optional(),
});

export const SourceRefSchema = z.object({
  name: z.string().min(1),
  url: httpUrl.optional(),
  retrieved: z.union([z.string().date(), z.string().datetime({ offset: true })]).optional(),
});

export const TransitBasisSchema = z.enum(['unavailable', 'scheduled', 'realtime']);
/** Why a schedule lookup found no direct boardable trip (02 §8.3); shown as text, never as a number. */
export const TransitReasonSchema = z.enum(['no_boardable_trip', 'transfer_required', 'no_service', 'unknown_stop']);

/** An active service alert, as plain text. It is data for the rider, never instructions for the app. */
export const TransitAlertSchema = z.object({
  header: z.string().min(1).max(300),
  description: z.string().min(1).max(600).optional(),
  url: httpUrl.optional(),
});

/** One structured citation: the fact or source behind a number, with the source's attribution text. */
export const CitationRefSchema = z.object({
  ref: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  attribution: z.string().min(1).optional(),
  retrieved: z.string().date().optional(),
  factId: z.number().int().optional(),
  url: httpUrl.optional(),
});

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
    // P4b additions, all optional: the scheduled trip's details, or the reason none was found.
    leaveBy: z.string().regex(HHMM, 'Expected HH:MM (24-hour)').optional(),
    routeShortName: z.string().min(1).optional(),
    routing: z.literal('direct_only').optional(),
    reason: TransitReasonSchema.optional(),
    alerts: z.array(TransitAlertSchema).max(3).optional(),
    // The full scheduled times behind the HH:MM fields (which stay as they were), the trip's GTFS service day, and the
    // arrival target the lookup was for (also kept when it found no trip), so a next-day trip keeps its date.
    leaveByAt: offsetDateTime().optional(),
    departureAt: offsetDateTime().optional(),
    arrivalAt: offsetDateTime().optional(),
    serviceDate: z.string().date().optional(),
    targetAt: offsetDateTime().optional(),
  })
  .superRefine((leg, ctx) => {
    if (leg.basis !== 'unavailable' && leg.reason !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'a reason explains a missing trip, so it needs basis "unavailable"' });
    }
    if (leg.basis === 'unavailable') {
      for (const key of ['leaveBy', 'leaveByAt', 'departureAt', 'arrivalAt', 'serviceDate'] as const) {
        if (leg[key] !== undefined) ctx.addIssue({ code: 'custom', path: [key], message: `${key} needs a scheduled trip` });
      }
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
  // null when routing is unavailable (meta.degraded says why), so the transit basis is still reported.
  drive: DriveLegSchema.nullable(),
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
  // Live flow data describes current conditions only, so the density is labeled as such.
  trafficDensityLabel: z.literal('Traffic now').optional(),
  // P4b: structured citations (fact ids and attribution) behind `citations`.
  sources: z.array(CitationRefSchema).optional(),
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
    if (response.incentiveDetails !== null && response.meta?.offerActive !== true) {
      ctx.addIssue({ code: 'custom', path: ['incentiveDetails'], message: 'incentiveDetails requires meta.offerActive to be true (D-25)' });
    }
  });

export type TrafficDensity = z.infer<typeof TrafficDensitySchema>;
export type LatLng = z.infer<typeof LatLngSchema>;
export type TransitInsightRequest = z.infer<typeof TransitInsightRequestSchema>;
export type IncentiveDetails = z.infer<typeof IncentiveDetailsSchema>;
export type AdditionalRide = z.infer<typeof AdditionalRideSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type TransitBasis = z.infer<typeof TransitBasisSchema>;
export type TransitReason = z.infer<typeof TransitReasonSchema>;
export type TransitAlert = z.infer<typeof TransitAlertSchema>;
export type CitationRef = z.infer<typeof CitationRefSchema>;
export type Comparison = z.infer<typeof ComparisonSchema>;
export type Narration = z.infer<typeof NarrationSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type TransitInsightResponse = z.infer<typeof TransitInsightResponseSchema>;
