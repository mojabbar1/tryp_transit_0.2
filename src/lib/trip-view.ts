import type { IncentiveDetails, TransitInsightResponse } from '@/lib/contracts/transit-insights';
import type { TripSummary } from '@/contexts/travel-context';
import { formatClock, formatScheduleTime } from '@/lib/format';
import { toNumberOrNull } from '@/lib/utils';

/** The routes page leaves only when no trip was loaded; a successful trip may have every measurement unavailable. */
export function shouldLeaveRoutesPage(trip: { hasTrip: boolean }): boolean {
  return !trip.hasTrip;
}

/** A reward is shown only when the trip response carried one with an active offer (D-25). */
export function visibleIncentive(trip: { incentiveDetails: IncentiveDetails | null; offerActive: boolean }): IncentiveDetails | null {
  return trip.offerActive ? trip.incentiveDetails : null;
}

/**
 * A scheduled time as shown on the home and routes pages: from the full time, in the region's zone, with its day when
 * it isn't the day the answer was made ("8:05 AM tomorrow"); else the HH:MM field (older or demo answers); else null.
 */
export function scheduledTimeText(
  at: string | undefined,
  hhmm: string | undefined,
  zone: { timezone?: string; generatedAt?: string } | undefined,
): string | null {
  return formatScheduleTime(at, zone?.timezone, zone?.generatedAt) ?? (hhmm ? formatClock(hhmm) : null);
}

/** The routes page's view of one /api/transit-insights response: nothing it doesn't carry is filled in. */
export function tripSummaryFrom(insights: TransitInsightResponse): TripSummary {
  const transit = insights.comparison?.transit;
  return {
    travelTime: insights.travelTime ?? null,
    trafficDensity: insights.trafficDensity ?? null,
    costSavings: toNumberOrNull(insights.comparison?.costUsd?.difference ?? insights.costSavingsPerTrip),
    additionalRides: insights.additionalRides ?? [],
    incentiveDetails: insights.incentiveDetails ?? null,
    offerActive: insights.meta?.offerActive === true,
    isDemo: insights.meta?.demo === true,
    transitBasis: transit?.basis,
    leaveBy: transit?.leaveBy,
    routeShortName: transit?.routeShortName,
    nextDepartures: transit?.nextDepartures ?? [],
    transitReason: transit?.reason,
    alerts: transit?.alerts ?? [],
    sources: insights.meta?.sources ?? [],
    citations: insights.meta?.citations ?? [],
    leaveByAt: transit?.leaveByAt,
    departureAt: transit?.departureAt,
    arrivalAt: transit?.arrivalAt,
    serviceDate: transit?.serviceDate,
    targetAt: transit?.targetAt,
    timezone: insights.meta?.timezone,
    generatedAt: insights.meta?.generatedAt,
  };
}
