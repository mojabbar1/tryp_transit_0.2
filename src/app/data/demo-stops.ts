/**
 * DEMO DATA ONLY: the stops the demo scenarios pre-fill, for offline demo mode (NEXT_PUBLIC_DEMO_MODE=true, D-17).
 *
 * These are the P0 keys from 05 §2b, each chosen to be within ~350 m of a real CARTA stop. Their GTFS stop ids are
 * **not mapped**: 05 §2b is unsigned, so `gtfsStopId` stays null until a human verifies each pair against
 * `/v1/compare` and signs the table. Nothing here is a real stop or a live result, and live mode never reads it.
 * The weekend scenario is Isle of Palms / 14th Avenue (~342 m from a CARTA stop), not Folly Beach (~3.7 km away).
 */
import type { DemoScenarioId } from '@/lib/demo/scenarios';

export type DemoStop = {
  /** The P0 location key (busStopCoordinates.ts), not a GTFS stop id. */
  key: string;
  lat: number;
  lng: number;
  /** Null until 05 §2b is signed; never filled from synthetic or fixture data. */
  gtfsStopId: null;
};

export type DemoScenarioStops = { departure: DemoStop; destination: DemoStop; arriveBy: string };

export const DEMO_STOP_MAPPING_STATUS = 'pending_05_2b_signoff' as const;

export const demoScenarioStops: Record<DemoScenarioId, DemoScenarioStops> = {
  'rush-hour': {
    departure: { key: 'King Street / Morris Street', lat: 32.7872, lng: -79.9416, gtfsStopId: null },
    destination: { key: 'Spring Street / Ashley Avenue', lat: 32.7878, lng: -79.9512, gtfsStopId: null },
    arriveBy: '08:30',
  },
  weekend: {
    departure: { key: 'Market Street / Meeting Street', lat: 32.7813, lng: -79.9306, gtfsStopId: null },
    destination: { key: 'Isle of Palms / 14th Avenue', lat: 32.789, lng: -79.789, gtfsStopId: null },
    arriveBy: '14:00',
  },
  'night-out': {
    departure: { key: 'King Street / Wentworth Street', lat: 32.7831, lng: -79.9363, gtfsStopId: null },
    destination: { key: 'Calhoun Street / King Street', lat: 32.785, lng: -79.9366, gtfsStopId: null },
    arriveBy: '23:30',
  },
};
