import { formatCostDifference } from '@/lib/format';

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
