export type Arrival = {
  arrivalUtc: string;
  minutesUntil: number;
  localHour: number;
  dayType: 'weekday' | 'weekend';
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Resolve a wall-clock arrival in tz, independent of the host timezone.
 * DST gap: shift forward by the gap (New York 02:30 -> 03:30).
 * DST fold: use the earlier occurrence. If it has passed, use tomorrow,
 * even if the second occurrence is still ahead. Equality with now is not past.
 * localHour/dayType describe the resolved arrival, not the request's current day.
 */
export function resolveArrival(hhmm: string, now: Date, tz: string): Arrival {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm) || !Number.isFinite(now.getTime())) {
    throw new RangeError('Expected HH:MM and a valid current date');
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const wallTime = (instant: number): number => {
    const parts = formatter.formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes): number => {
      const value = parts.find((entry) => entry.type === type)?.value;
      if (value === undefined) throw new RangeError(`Missing timezone date part: ${type}`);
      return Number(value);
    };
    const date = new Date(0);
    date.setUTCFullYear(part('year'), part('month') - 1, part('day'));
    date.setUTCHours(part('hour'), part('minute'), part('second'), 0);
    return date.getTime();
  };
  const resolveWall = (target: number): number => {
    // Observe both sides of nearby offset transitions, including non-hour DST
    // and date-line shifts; do not assume that a local day is 24 elapsed hours.
    const offsets = new Set<number>();
    for (let hours = -48; hours <= 48; hours += 1) {
      const sample = target + hours * HOUR_MS;
      offsets.add(wallTime(sample) - sample);
    }
    const candidates = [...offsets].map((offset) => target - offset);
    const exact = candidates.filter((instant) => wallTime(instant) === target);
    if (exact.length > 0) return Math.min(...exact);
    const forward = candidates
      .map((instant) => ({ instant, shift: wallTime(instant) - target }))
      .filter(({ shift }) => shift > 0)
      .sort((a, b) => a.shift - b.shift || a.instant - b.instant);
    if (!forward[0]) throw new RangeError('Unable to resolve local arrival time');
    return forward[0].instant;
  };

  const [hours, minutes] = hhmm.split(':').map(Number);
  const target = new Date(wallTime(now.getTime()));
  target.setUTCHours(hours, minutes, 0, 0);
  let arrival = resolveWall(target.getTime());
  if (arrival < now.getTime()) arrival = resolveWall(target.getTime() + DAY_MS);
  const local = new Date(wallTime(arrival));
  return {
    arrivalUtc: new Date(arrival).toISOString(),
    minutesUntil: (arrival - now.getTime()) / MINUTE_MS,
    localHour: local.getUTCHours(),
    dayType: [0, 6].includes(local.getUTCDay()) ? 'weekend' : 'weekday',
  };
}
