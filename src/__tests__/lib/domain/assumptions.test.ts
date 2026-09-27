import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SourceRefSchema } from '@/lib/contracts/transit-insights';
import { assumptions } from '@/lib/domain/assumptions';

const decisions = readFileSync(
  resolve(__dirname, '../../../../docs/transit-data-agent/05-decisions-and-review.md'),
  'utf8',
);

function approvedRows() {
  const section = decisions.split('## 2.')[1]?.split('## 2a.')[0];
  if (!section) throw new Error('Missing assumptions approval table');
  return section.split('\n').flatMap((line) => {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const key = cells[0]?.match(/^`([^`]+)`/)?.[1];
    if (!key || !cells[5]) return [];
    return [{ key, unit: cells[2], approved: cells[5].replaceAll('**', '') }];
  });
}

function approvedValue(key: string, approved: string): unknown {
  if (key === 'cost.basis') {
    // The rest of this policy is also guarded: total ownership cost is never per-trip.
    expect(approved).toBe('Marginal (fuel + maintenance) per trip; total cost of ownership for annual stats only');
    return 'marginal';
  }
  if (key === 'traffic.density_thresholds') {
    const match = approved.match(/^Light ≥ ([\d.]+), Medium ≥ ([\d.]+), Heavy < ([\d.]+); labeled "Traffic now"$/);
    if (!match || match[2] !== match[3]) throw new Error('Unrecognized approved thresholds');
    return { lightMin: Number(match[1]), mediumMin: Number(match[2]) };
  }
  if (['incentive.policy', 'nudge.tone_rules', 'headline.congestion'].includes(key)) return approved;
  const number = approved.match(/^(\d+(?:\.\d+)?)(?:\s|$)/);
  if (!number) throw new Error(`Unrecognized approved numeric value: ${key}`);
  return Number(number[1]);
}

describe('approved assumptions drift guard', () => {
  const rows = approvedRows();

  it('has exactly the approved keys, with no unapproved parking applicability', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(assumptions).sort()).toEqual(rows.map(({ key }) => key).sort());
    expect(assumptions).not.toHaveProperty('parking.applies_to_stops');
  });

  it.each(rows)('$key equals the Approved value, not the proposal', ({ key, unit, approved }) => {
    const entry = Object.entries(assumptions).find(([name]) => name === key)?.[1];
    expect(entry?.value).toEqual(approvedValue(key, approved));
    expect(entry?.unit).toBe(unit);
    expect(SourceRefSchema.safeParse(entry?.source).success).toBe(true);
  });

  it('retains primary-source evidence and the recorded retrieval dates', () => {
    for (const entry of Object.values(assumptions)) {
      expect(entry.source.retrieved).toMatch(/^2026-09-(25|27)$/);
      if (!entry.source.url.includes('github.com')) {
        expect(decisions).toContain(`[${entry.source.name}](${entry.source.url})`);
      }
    }
    expect(assumptions['drive.fuel_price_usd_per_gal'].source.retrieved).toBe('2026-09-27');
  });
});
