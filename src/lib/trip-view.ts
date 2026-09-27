import type { IncentiveDetails } from '@/lib/contracts/transit-insights';

/** The routes page leaves only when no trip was loaded; a successful trip may have every measurement unavailable. */
export function shouldLeaveRoutesPage(trip: { hasTrip: boolean }): boolean {
  return !trip.hasTrip;
}

/** A reward is shown only when the trip response carried one with an active offer (D-25). */
export function visibleIncentive(trip: { incentiveDetails: IncentiveDetails | null; offerActive: boolean }): IncentiveDetails | null {
  return trip.offerActive ? trip.incentiveDetails : null;
}
