/**
 * Unit tests for shared utilities
 */

import { toNumberOrNull } from '@/lib/utils';

describe('toNumberOrNull', () => {
  it('parses numeric strings from the API contract', () => {
    expect(toNumberOrNull('2.50')).toBe(2.5);
    expect(toNumberOrNull('4.25')).toBe(4.25);
  });

  it('keeps a legitimate zero', () => {
    expect(toNumberOrNull('0')).toBe(0);
    expect(toNumberOrNull(0)).toBe(0);
  });

  it('passes numbers through', () => {
    expect(toNumberOrNull(3)).toBe(3);
  });

  it('returns null for non-numeric strings instead of NaN', () => {
    expect(toNumberOrNull('$2.50')).toBeNull();
    expect(toNumberOrNull('about two dollars')).toBeNull();
  });

  it('returns null for missing or empty values instead of 0', () => {
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
    expect(toNumberOrNull('')).toBeNull();
    expect(toNumberOrNull('   ')).toBeNull();
  });

  it('returns null for non-finite values', () => {
    expect(toNumberOrNull(Number.NaN)).toBeNull();
    expect(toNumberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
