import { formatCostDifference, formatScheduleTime } from '@/lib/format';

describe('formatCostDifference', () => {
  it.each([
    [0.51, 'save $0.51'],
    [3.96, 'save $3.96'],
    [-0.51, 'costs $0.51 more'],
    [0, 'about the same'],
    [0.004, 'about the same'],
    [-0.005, 'about the same'],
  ])('%p → %p (single $, formatted from a number)', (difference, text) => {
    expect(formatCostDifference(difference)).toBe(text);
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])('returns null for %p', (difference) => {
    expect(formatCostDifference(difference)).toBeNull();
  });
});

describe('formatScheduleTime (review F3): a scheduled time with its day, in the region zone', () => {
  const NY = 'America/New_York';
  // 16:00 in New York on Monday, October 5, 2026 (the review's case).
  const AT_4PM = '2026-10-05T20:00:00.000Z';

  it.each([
    ['the same day', '2026-10-05T17:05:00-04:00', AT_4PM, '5:05 PM'],
    ['the next day (the review case: 08:05 asked at 16:00)', '2026-10-06T08:05:00-04:00', AT_4PM, '8:05 AM tomorrow'],
    ['midnight the next day', '2026-10-06T00:00:00-04:00', AT_4PM, '12:00 AM tomorrow'],
    ['a later day, with its date', '2026-10-08T08:05:00-04:00', AT_4PM, '8:05 AM on Thu, Oct 8'],
    ['an instant written in UTC, shown in the region zone', '2026-10-06T12:05:00Z', AT_4PM, '8:05 AM tomorrow'],
  ])('%s', (_label, at, reference, text) => {
    expect(formatScheduleTime(at, NY, reference)).toBe(text);
  });

  it('overnight: a trip that leaves tonight and arrives after midnight shows each time on its own day', () => {
    const tenPm = '2026-10-06T02:00:00.000Z';
    expect(formatScheduleTime('2026-10-05T23:45:00-04:00', NY, tenPm)).toBe('11:45 PM');
    expect(formatScheduleTime('2026-10-06T00:20:00-04:00', NY, tenPm)).toBe('12:20 AM tomorrow');
  });

  it('days are counted in the region zone, not in UTC or the host zone', () => {
    // 19:00 and 21:00 in New York on October 5 are already October 6 in UTC: still the same day for the rider.
    expect(formatScheduleTime('2026-10-05T21:00:00-04:00', NY, '2026-10-05T23:00:00Z')).toBe('9:00 PM');
    // One instant, two regions: 22:30 the same evening in Los Angeles, 01:30 the next morning in New York.
    expect(formatScheduleTime('2026-10-06T01:30:00-04:00', 'America/Los_Angeles', '2026-10-06T03:00:00Z')).toBe('10:30 PM');
    expect(formatScheduleTime('2026-10-06T01:30:00-04:00', NY, '2026-10-06T03:00:00Z')).toBe('1:30 AM tomorrow');
  });

  it('across the end of daylight saving time, the next morning is still "tomorrow"', () => {
    // Asked at 16:00 EDT on Saturday, October 31, 2026; the bus leaves at 08:05 EST on Sunday, November 1.
    expect(formatScheduleTime('2026-11-01T08:05:00-05:00', NY, '2026-10-31T20:00:00Z')).toBe('8:05 AM tomorrow');
  });

  it.each([
    ['no time', undefined, NY, AT_4PM],
    ['a time without an offset', '2026-10-06T08:05:00', NY, AT_4PM],
    ['an HH:MM clock', '08:05', NY, AT_4PM],
    ['no zone', '2026-10-06T08:05:00-04:00', undefined, AT_4PM],
    ['an unknown zone', '2026-10-06T08:05:00-04:00', 'Mars/Olympus_Mons', AT_4PM],
    ['no reference', '2026-10-06T08:05:00-04:00', NY, undefined],
    ['an impossible date', '2026-02-30T08:05:00-05:00', NY, AT_4PM],
  ])('returns null for %s, so the caller keeps its HH:MM field', (_label, at, zone, reference) => {
    expect(formatScheduleTime(at, zone, reference)).toBeNull();
  });
});
