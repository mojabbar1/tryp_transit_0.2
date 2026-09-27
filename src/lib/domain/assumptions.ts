import type { SourceRef } from '@/lib/contracts/transit-insights';

type Assumption<T> = {
  readonly value: T;
  readonly unit: string;
  readonly source: Readonly<Required<SourceRef>>;
};

const decisionUrl =
  'https://github.com/mojabbar1/tryp_transit_0.2/blob/9a5fa76/docs/transit-data-agent/05-decisions-and-review.md#2-assumptions-table-the-p1-source-of-truth-p35-moves-it-into-the-fact-store';
const policySource = (name: string): Required<SourceRef> => ({
  name,
  url: decisionUrl,
  retrieved: '2026-09-27',
});
const epa = {
  name: 'EPA-420-F-23-014',
  url: 'https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle',
  retrieved: '2026-09-25',
};
const aaa = {
  name: 'AAA Your Driving Costs 2025 fact sheet',
  url: 'https://newsroom.aaa.com/wp-content/uploads/2025/09/UPDATE-AAA-Fact-Sheet-Your-Driving-Cost-9.2025-1.pdf',
  retrieved: '2026-09-25',
};

// Only approved §2 values. Parking applicability is deliberately absent.
export const assumptions = {
  'cost.basis': {
    value: 'marginal',
    unit: '—',
    source: policySource('Policy (avoids overstating savings, R-13)'),
  },
  'drive.fuel_price_usd_per_gal': {
    value: 4.163,
    unit: 'USD/gal',
    source: {
      name: 'EIA series page',
      url: 'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMM_EPMR_PTE_R1Z_DPG&f=W',
      retrieved: '2026-09-27',
    },
  },
  'drive.mpg': { value: 22.2, unit: 'mpg', source: epa },
  'drive.maintenance_usd_per_mile': { value: 0.1104, unit: 'USD/mile', source: aaa },
  'drive.total_cost_usd_per_mile': { value: 0.77, unit: 'USD/mile', source: aaa },
  'parking.downtown_usd': {
    value: 24.00,
    unit: 'USD',
    source: {
      name: 'City of Charleston, Where to Park',
      url: 'https://www.charleston-sc.gov/1025/Where-to-Park',
      retrieved: '2026-09-25',
    },
  },
  'transit.base_fare_usd': {
    value: 2.00,
    unit: 'USD',
    source: {
      name: 'CARTA Fares & Passes',
      url: 'https://ridecarta.com/fares-passes/',
      retrieved: '2026-09-25',
    },
  },
  'co2.car_g_per_mile': { value: 400, unit: 'g CO2/vehicle-mile', source: epa },
  'co2.car_occupancy': { value: 1.0, unit: 'persons', source: policySource('Policy') },
  'co2.bus_g_per_passenger_mile': {
    value: 290,
    unit: 'g CO2/pax-mile',
    source: {
      name: 'FTA 2010 EPA-webinar deck',
      url: 'https://www.epa.gov/sites/default/files/2016-04/documents/public_transportations_role_in_responding_to_climate_change.pdf',
      retrieved: '2026-09-25',
    },
  },
  'traffic.density_thresholds': {
    value: { lightMin: 0.85, mediumMin: 0.60 },
    unit: 'ratio',
    source: policySource('Engineering default'),
  },
  'transit.access_buffer_min': {
    value: 5,
    unit: 'min',
    source: policySource('Engineering default'),
  },
  'incentive.policy': {
    value: 'Demo-only until D-25 funded offers exist; when live, eCredit within $0.50–$2.00, chosen deterministically',
    unit: 'USD',
    source: policySource('Product policy'),
  },
  'nudge.tone_rules': {
    value: 'As proposed: 1–2 sentences; no false urgency or fear; numbers by reference only; "about" for estimates; no demographic targeting',
    unit: '—',
    source: policySource('Policy (R-13)'),
  },
  'headline.congestion': {
    value: '35.5% congestion level and 48 h lost in rush hour (TomTom 2025, City view; label it "City")',
    unit: '% / hours',
    source: {
      name: 'TomTom Traffic Index, Charleston',
      url: 'https://www.tomtom.com/traffic-index/city/charleston-sc/',
      retrieved: '2026-09-25',
    },
  },
} as const satisfies Record<string, Assumption<string | number | {
  readonly lightMin: number;
  readonly mediumMin: number;
}>>;

export type AssumptionKey = keyof typeof assumptions;
