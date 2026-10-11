import type { StatView } from './types';

/** A stat's value as shown: the number with its unit, or its text; never a number the fact doesn't hold. */
export function formatStatValue(stat: Pick<StatView, 'valueNum' | 'valueText' | 'unit'>): string {
  if (stat.valueNum === null) return stat.valueText ?? 'Unavailable';
  const unit = stat.unit?.trim() ?? '';
  const number = stat.valueNum.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (/^(%|percent\b)/i.test(unit)) return `${number}%`;
  return unit ? `${number} ${unit}` : number;
}
