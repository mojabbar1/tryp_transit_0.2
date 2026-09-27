import type { TrafficDensity } from '@/lib/contracts/transit-insights';
import { assumptions } from './assumptions';

export type FlowSpeeds = {
  readonly currentSpeed?: number | null;
  readonly freeFlowSpeed?: number | null;
};

export type DensityThresholds = {
  readonly lightMin: number;
  readonly mediumMin: number;
};

/** Unweighted mean of sample speed ratios, not a forecast or a route-weighted density.
 * Any missing/invalid sample makes the result unknown; never drop it and guess.
 */
export function densityFromFlows(
  flows: readonly (FlowSpeeds | null | undefined)[],
  thresholds: DensityThresholds = assumptions['traffic.density_thresholds'].value,
): TrafficDensity | null {
  const { lightMin, mediumMin } = thresholds;
  if (!Number.isFinite(lightMin) || !Number.isFinite(mediumMin)
    || mediumMin <= 0 || lightMin <= mediumMin || lightMin > 1) {
    throw new RangeError('Expected ordered density thresholds within (0, 1]');
  }
  if (flows.length === 0) return null;
  let mean = 0;
  for (const flow of flows) {
    const current = flow?.currentSpeed;
    const free = flow?.freeFlowSpeed;
    if (typeof current !== 'number' || typeof free !== 'number'
      || !Number.isFinite(current) || !Number.isFinite(free) || current <= 0 || free <= 0) {
      return null;
    }
    const ratio = current / free;
    if (!Number.isFinite(ratio)) return null;
    mean += ratio / flows.length;
  }
  if (!Number.isFinite(mean)) return null;
  return mean >= lightMin ? 'Light' : mean >= mediumMin ? 'Medium' : 'Heavy';
}
