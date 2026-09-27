import { resolveArrival } from '@/lib/domain/time';

const tz = 'America/New_York';

describe('resolveArrival', () => {
  it.each([
    ['08:30', '2026-03-06T12:00:00Z', '2026-03-06T13:30:00.000Z', 90, 8, 'weekday'],
    ['08:30', '2026-03-06T14:00:00Z', '2026-03-07T13:30:00.000Z', 1410, 8, 'weekend'],
    ['00:00', '2026-12-31T23:00:00Z', '2027-01-01T05:00:00.000Z', 360, 0, 'weekday'],
    ['08:30', '2026-03-06T13:30:00Z', '2026-03-06T13:30:00.000Z', 0, 8, 'weekday'],
    // Spring gap shifts 02:30 to 03:30, preserving the position within the gap.
    ['02:30', '2026-03-08T05:00:00Z', '2026-03-08T07:30:00.000Z', 150, 3, 'weekend'],
    ['03:30', '2026-03-08T05:00:00Z', '2026-03-08T07:30:00.000Z', 150, 3, 'weekend'],
    ['01:30', '2026-03-08T06:45:00Z', '2026-03-09T05:30:00.000Z', 1365, 1, 'weekday'],
    ['02:30', '2026-03-08T08:00:00Z', '2026-03-09T06:30:00.000Z', 1350, 2, 'weekday'],
    // Fall fold uses the earlier 01:30 (EDT), not the later one (EST).
    ['01:30', '2026-11-01T04:00:00Z', '2026-11-01T05:30:00.000Z', 90, 1, 'weekend'],
    ['01:30', '2026-11-01T05:45:00Z', '2026-11-02T06:30:00.000Z', 1485, 1, 'weekday'],
    ['02:30', '2026-11-01T04:00:00Z', '2026-11-01T07:30:00.000Z', 210, 2, 'weekend'],
    ['00:30', '2026-11-01T05:00:00Z', '2026-11-02T05:30:00.000Z', 1470, 0, 'weekday'],
  ])('%s from %s resolves across calendar/DST boundaries', (time, now, arrivalUtc, minutesUntil, localHour, dayType) => {
    expect(resolveArrival(time, new Date(now), tz)).toEqual({ arrivalUtc, minutesUntil, localHour, dayType });
  });

  it('supports fractional-hour zones and does not mutate now', () => {
    const now = new Date('2026-09-27T00:00:30Z');
    expect(resolveArrival('06:00', now, 'Asia/Kathmandu')).toEqual({
      arrivalUtc: '2026-09-27T00:15:00.000Z', minutesUntil: 14.5, localHour: 6, dayType: 'weekend',
    });
    expect(now.toISOString()).toBe('2026-09-27T00:00:30.000Z');
  });

  it('supports a half-hour DST gap', () => {
    expect(resolveArrival('02:15', new Date('2026-10-03T14:00:00Z'), 'Australia/Lord_Howe')).toEqual({
      arrivalUtc: '2026-10-03T15:45:00.000Z', minutesUntil: 105, localHour: 2, dayType: 'weekend',
    });
  });

  it.each(['', '8:30', '24:00', '12:60', '12:30:00'])('rejects invalid HH:MM %p', (time) => {
    expect(() => resolveArrival(time, new Date(), tz)).toThrow(RangeError);
  });

  it('surfaces invalid dates and timezones instead of guessing', () => {
    expect(() => resolveArrival('12:00', new Date('invalid'), tz)).toThrow(RangeError);
    expect(() => resolveArrival('12:00', new Date(), 'Invalid/Zone')).toThrow(RangeError);
  });
});
