import { z } from 'zod';

/** Signed drive − transit cost (USD) as UI copy: "save $x", "about the same", or "costs $x more"; null when unknown. */
export function formatCostDifference(difference: number | null | undefined): string | null {
  if (difference === null || difference === undefined || !Number.isFinite(difference)) return null;
  const cents = Math.round(difference * 100);
  if (cents === 0) return 'about the same';
  const amount = `$${(Math.abs(cents) / 100).toFixed(2)}`;
  return cents > 0 ? `save ${amount}` : `costs ${amount} more`;
}

/** "08:05" → "8:05 AM", "23:30" → "11:30 PM"; anything that isn't HH:MM is returned unchanged. */
export function formatClock(hhmm: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return hhmm;
  const hour = Number(match[1]);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

// An offset-qualified ISO 8601 time on a real calendar date, checked as the contract checks it.
const OffsetDateTime = z.string().datetime({ offset: true });
const DAY_MS = 86_400_000;

/** The calendar date, wall clock and short day label of an instant in `timeZone`, independent of the host's zone. */
function zoned(instant: Date, timeZone: string) {
  const options = { timeZone, calendar: 'gregory', numberingSystem: 'latn' } as const;
  const parts = new Intl.DateTimeFormat('en-US', {
    ...options,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  const label = new Intl.DateTimeFormat('en-US', { ...options, weekday: 'short', month: 'short', day: 'numeric' }).formatToParts(instant);
  const labelPart = (type: Intl.DateTimeFormatPartTypes) => label.find((entry) => entry.type === type)?.value ?? '';
  return {
    dayNumber: Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day'))) / DAY_MS,
    hhmm: `${part('hour')}:${part('minute')}`,
    label: `${labelPart('weekday')}, ${labelPart('month')} ${labelPart('day')}`,
  };
}

/**
 * A scheduled time as a rider reads it in the region's time zone, with its day relative to `reference` (when the answer
 * was made): "8:05 AM" that day, "8:05 AM tomorrow" the next, else "8:05 AM on Tue, Oct 6". Null unless `at` and
 * `reference` are offset-qualified ISO times and `timeZone` is valid, so callers can fall back to an HH:MM field.
 */
export function formatScheduleTime(at: string | undefined, timeZone: string | undefined, reference: string | undefined): string | null {
  if (!at || !timeZone || !reference || !OffsetDateTime.safeParse(at).success || !OffsetDateTime.safeParse(reference).success) {
    return null;
  }
  const instant = new Date(at);
  const now = new Date(reference);
  let when: ReturnType<typeof zoned>;
  let today: ReturnType<typeof zoned>;
  try {
    when = zoned(instant, timeZone);
    today = zoned(now, timeZone);
  } catch {
    return null;
  }
  if (!Number.isFinite(when.dayNumber) || !Number.isFinite(today.dayNumber)) return null;
  const clock = formatClock(when.hhmm);
  const days = when.dayNumber - today.dayNumber;
  if (days === 0) return clock;
  if (days === 1) return `${clock} tomorrow`;
  return `${clock} on ${when.label}`;
}

const TRANSIT_REASON_TEXT: Record<string, string> = {
  no_boardable_trip: 'No direct bus you can still catch arrives by that time.',
  transfer_required: 'No single bus serves both stops; this trip needs a transfer, which isn’t supported yet.',
  no_service: 'There’s no scheduled bus service on that day.',
  unknown_stop: 'That stop isn’t in the current CARTA schedule.',
};

/** Plain-language text for a schedule lookup's reason code; never a number. */
export function transitReasonText(reason: string | null | undefined): string | null {
  return reason ? TRANSIT_REASON_TEXT[reason] ?? null : null;
}
