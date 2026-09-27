import { assumptions } from '@/lib/domain/assumptions';
import { densityFromFlows } from '@/lib/domain/traffic';

describe('densityFromFlows', () => {
  it.each([
    [85, 'Light'], [84.99, 'Medium'], [60, 'Medium'], [59.99, 'Heavy'], [100, 'Light'], [110, 'Light'],
  ])('classifies %s / 100 at the approved inclusive boundaries', (currentSpeed, expected) => {
    expect(densityFromFlows([{ currentSpeed, freeFlowSpeed: 100 }], assumptions['traffic.density_thresholds'].value))
      .toBe(expected);
  });

  it('averages per-sample ratios, not raw speeds or rounded categories', () => {
    expect(densityFromFlows([
      { currentSpeed: 90, freeFlowSpeed: 100 },
      { currentSpeed: 4, freeFlowSpeed: 10 },
    ])).toBe('Medium');
  });

  it.each([3, 10, 100])('preserves exact category boundaries with %s identical samples', (count) => {
    expect(densityFromFlows(Array.from({ length: count }, () => ({ currentSpeed: 85, freeFlowSpeed: 100 }))))
      .toBe('Light');
    expect(densityFromFlows(Array.from({ length: count }, () => ({ currentSpeed: 60, freeFlowSpeed: 100 }))))
      .toBe('Medium');
  });

  it.each([0, -1, NaN, Infinity, -Infinity, null, undefined])('returns null for bad speed %p, even with a good sample', (speed) => {
    const good = { currentSpeed: 90, freeFlowSpeed: 100 };
    expect(densityFromFlows([good, { currentSpeed: speed, freeFlowSpeed: 100 }])).toBeNull();
    expect(densityFromFlows([good, { currentSpeed: 90, freeFlowSpeed: speed }])).toBeNull();
  });

  it('returns null for absent samples and ratios that overflow', () => {
    expect(densityFromFlows([])).toBeNull();
    expect(densityFromFlows([null])).toBeNull();
    expect(densityFromFlows([undefined])).toBeNull();
    expect(densityFromFlows([{}])).toBeNull();
    expect(densityFromFlows([{ currentSpeed: Number.MAX_VALUE, freeFlowSpeed: Number.MIN_VALUE }])).toBeNull();
  });

  it.each([
    { lightMin: NaN, mediumMin: 0.6 },
    { lightMin: 0.85, mediumMin: Infinity },
    { lightMin: 0.6, mediumMin: 0.85 },
    { lightMin: 0.6, mediumMin: 0.6 },
    { lightMin: 1.1, mediumMin: 0.6 },
    { lightMin: 0.85, mediumMin: 0 },
  ])('surfaces invalid threshold configuration %p', (thresholds) => {
    expect(() => densityFromFlows([], thresholds)).toThrow(RangeError);
  });
});
