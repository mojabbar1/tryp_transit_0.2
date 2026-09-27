import type { IncentiveDetails } from '@/lib/contracts/transit-insights';

export type IncentiveResult = {
  incentiveDetails: IncentiveDetails | null;
  offerActive: boolean;
};

/** D-25: no approved, funded, redeemable inventory exists in P1.
 * Policy bounds are not inventory. Neither caller input nor an LLM can activate an offer.
 */
export function evaluateIncentivePolicy(): IncentiveResult {
  return { incentiveDetails: null, offerActive: false };
}
