import type { ApprovedFacts } from './approved';

/**
 * Pure row builders for the emissions and safety/cost pages (P4b). Every value is an approved fact or a
 * deterministic computation from approved facts; a row whose inputs are missing has `value: null` and the page
 * shows "Data unavailable". Nothing here holds a number of its own.
 */

export interface FactRow {
  id: string;
  label: string;
  value: string | null;
  basis: string;
}

type Facts = ApprovedFacts['facts'];

const num = (facts: Facts, key: string): number | null => {
  const value = facts[key]?.valueNum;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
const grams = (value: number) => `${Math.round(value).toLocaleString('en-US')} g CO2`;
const usd = (value: number, digits = 2) => `$${value.toFixed(digits)}`;

export function emissionsRows(facts: Facts): FactRow[] {
  const car = num(facts, 'co2.car_g_per_mile');
  const occupancy = num(facts, 'co2.car_occupancy');
  const bus = num(facts, 'co2.bus_g_per_passenger_mile');
  const carPerPassenger = car !== null && occupancy !== null && occupancy > 0 ? car / occupancy : null;
  return [
    { id: 'car_vehicle_mile', label: 'Car, per vehicle-mile (tailpipe)', value: car === null ? null : grams(car), basis: 'Approved fact' },
    { id: 'car_occupancy', label: 'Car occupancy (drive-alone commute)', value: occupancy === null ? null : `${occupancy} person${occupancy === 1 ? '' : 's'}`, basis: 'Approved assumption' },
    { id: 'car_passenger_mile', label: 'Car, per passenger-mile', value: carPerPassenger === null ? null : grams(carPerPassenger), basis: 'Computed: car per vehicle-mile ÷ occupancy' },
    { id: 'bus_passenger_mile', label: 'Bus, per passenger-mile (national proxy, not CARTA-measured)', value: bus === null ? null : grams(bus), basis: 'Approved fact' },
    {
      id: 'difference_passenger_mile',
      label: 'Difference per passenger-mile (car − bus)',
      value: carPerPassenger === null || bus === null ? null : grams(carPerPassenger - bus),
      basis: 'Computed from the two rows above',
    },
  ];
}

export function costRows(facts: Facts): FactRow[] {
  const fuel = num(facts, 'drive.fuel_price_usd_per_gal');
  const mpg = num(facts, 'drive.mpg');
  const maintenance = num(facts, 'drive.maintenance_usd_per_mile');
  const total = num(facts, 'drive.total_cost_usd_per_mile');
  const fare = num(facts, 'transit.base_fare_usd');
  const parking = num(facts, 'parking.downtown_usd');
  const marginal = fuel !== null && mpg !== null && mpg > 0 && maintenance !== null ? fuel / mpg + maintenance : null;
  return [
    { id: 'fuel_price', label: 'Gasoline, per gallon', value: fuel === null ? null : usd(fuel, 3), basis: 'Approved fact' },
    { id: 'mpg', label: 'Average fuel economy', value: mpg === null ? null : `${mpg} mpg`, basis: 'Approved fact' },
    { id: 'maintenance', label: 'Maintenance, repair and tires, per mile', value: maintenance === null ? null : usd(maintenance, 4), basis: 'Approved fact' },
    { id: 'marginal_per_mile', label: 'Driving, marginal cost per mile', value: marginal === null ? null : usd(marginal), basis: 'Computed: gasoline ÷ mpg + maintenance' },
    { id: 'total_per_mile', label: 'Driving, total cost to own and operate per mile (annual figures only)', value: total === null ? null : usd(total), basis: 'Approved fact' },
    { id: 'parking', label: 'Downtown City garage, standard-rate workday', value: parking === null ? null : usd(parking), basis: 'Approved fact' },
    { id: 'fare', label: 'CARTA fixed-route one-way fare', value: fare === null ? null : usd(fare), basis: 'Approved fact' },
  ];
}

/** Says when any value came from the approved 05 §2 table instead of the fact store (the flagged fallback). */
export function factOriginNote(facts: Facts): string | null {
  return Object.values(facts).some((fact) => fact?.origin === 'local_fallback')
    ? 'Some values come from the approved assumptions table because the fact store is unavailable.'
    : null;
}
