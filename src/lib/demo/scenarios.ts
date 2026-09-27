/**
 * Demo scenarios for investor walkthroughs. These are the only place invented timings, savings and rewards
 * appear, and only while NEXT_PUBLIC_DEMO_MODE is on; every response carries meta.demo: true so the UI badges it.
 */

import type { Meta, TransitInsightResponse } from '@/lib/contracts/transit-insights';

type LegacyFields = Omit<TransitInsightResponse, 'comparison' | 'meta'>;

const scenarios = {
  'rush-hour': {
    travelTime: 22,
    trafficDensity: 'Heavy',
    costSavingsPerTrip: '4.25',
    nudgeMessage: 'Beat the rush hour traffic! Take the express bus and arrive stress-free while others sit in gridlock for 45+ minutes.',
    incentiveDetails: {
      type: 'eCredit',
      description: 'Earn $2.00 transit credit for choosing public transportation during peak hours',
      value: '$2.00',
    },
    additionalRides: [
      { departureTime: '08:15', travelTime: 25, trafficDensity: 'Heavy' },
      { departureTime: '08:45', travelTime: 28, trafficDensity: 'Heavy' },
    ],
  },
  weekend: {
    travelTime: 35,
    trafficDensity: 'Light',
    costSavingsPerTrip: '2.75',
    nudgeMessage: 'Perfect weekend adventure! Enjoy the scenic coastal route to Isle of Palms while saving money and reducing your carbon footprint.',
    incentiveDetails: {
      type: 'partnerDiscount',
      description: '20% off at participating Isle of Palms restaurants and shops',
      value: '20% discount',
    },
    additionalRides: [
      { departureTime: '13:30', travelTime: 32, trafficDensity: 'Light' },
      { departureTime: '14:30', travelTime: 38, trafficDensity: 'Medium' },
    ],
  },
  'night-out': {
    travelTime: 18,
    trafficDensity: 'Light',
    costSavingsPerTrip: '3.50',
    nudgeMessage: 'Safe night out guaranteed! Skip the parking hassles and ride safely with well-lit stops and late-night security.',
    incentiveDetails: {
      type: 'funReward',
      description: 'Free drink token at participating downtown bars and clubs',
      value: '1 free drink',
    },
    additionalRides: [
      { departureTime: '23:00', travelTime: 16, trafficDensity: 'Light' },
      { departureTime: '00:00', travelTime: 15, trafficDensity: 'Light' },
    ],
  },
} satisfies Record<string, LegacyFields>;

export type DemoScenarioId = keyof typeof scenarios;
export const DEMO_SCENARIO_IDS = Object.keys(scenarios) as DemoScenarioId[];

export const isDemoScenario = (value: unknown): value is DemoScenarioId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(scenarios, value);

/** The example offer counts as active only inside the demo, which is what lets the demo show its reward (D-25). */
function demoMeta(now: Date): Meta {
  return {
    generatedAt: now.toISOString(),
    region: 'charleston-sc',
    timezone: 'America/New_York',
    demo: true,
    offerActive: true,
    narration: { source: 'template', provider: 'template', validated: false },
    degraded: [],
    citations: [],
  };
}

export function demoResponse(id: DemoScenarioId, now: Date): TransitInsightResponse {
  return { ...scenarios[id], meta: demoMeta(now) };
}
