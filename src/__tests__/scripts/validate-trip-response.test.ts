/**
 * Unit tests for scripts/validate-trip-response.cjs
 */

import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const { checkTrip, verdictFor, FALLBACK_NUDGE } = require('../../scripts/validate-trip-response.cjs');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'validate-trip-response.cjs');

const validTrip = () => ({
  travelTime: 9,
  trafficDensity: 'Medium',
  costSavingsPerTrip: '1.85',
  nudgeMessage: 'Skip the jam and ride.',
  incentiveDetails: { type: 'eCredit', description: 'Credit for your next ride', value: '1.00' },
  additionalRides: [{ departureTime: '08:15', travelTime: 10, trafficDensity: 'Heavy' }],
});

describe('checkTrip', () => {
  it('accepts a complete trip response', () => {
    expect(checkTrip(validTrip())).toBe('ok');
  });

  it('accepts a trip without additionalRides', () => {
    const trip: Record<string, unknown> = validTrip();
    delete trip.additionalRides;

    expect(checkTrip(trip)).toBe('ok');
  });

  it('detects the hard-coded fallback', () => {
    expect(checkTrip({ ...validTrip(), nudgeMessage: FALLBACK_NUDGE })).toBe('fallback');
  });

  it.each([
    ['travelTime', { travelTime: -5 }],
    ['travelTime', { travelTime: '9' }],
    ['trafficDensity', { trafficDensity: { level: 'Medium' } }],
    ['trafficDensity', { trafficDensity: 'Gridlock' }],
    ['costSavingsPerTrip', { costSavingsPerTrip: undefined }],
    ['costSavingsPerTrip', { costSavingsPerTrip: '$2.50' }],
    ['costSavingsPerTrip', { costSavingsPerTrip: 2.5 }],
    ['nudgeMessage', { nudgeMessage: '   ' }],
    ['incentiveDetails', { incentiveDetails: null }],
    ['incentiveDetails.type', { incentiveDetails: { type: 'cash', description: 'x', value: '1' } }],
    ['incentiveDetails.description', { incentiveDetails: { type: 'eCredit', description: '', value: '1' } }],
    ['incentiveDetails.value', { incentiveDetails: { type: 'eCredit', description: 'x' } }],
    ['additionalRides', { additionalRides: 'none' }],
    ['additionalRides.travelTime', { additionalRides: [{ travelTime: 0, trafficDensity: 'Light' }] }],
    ['additionalRides.trafficDensity', { additionalRides: [{ travelTime: 5, trafficDensity: 'light' }] }],
    ['additionalRides.departureTime', { additionalRides: [{ travelTime: 5, trafficDensity: 'Light', departureTime: '8:15' }] }],
  ])('rejects an invalid %s', (field, override) => {
    expect(checkTrip({ ...validTrip(), ...override })).toBe(`contract:${field}`);
  });

  it('rejects non-object bodies', () => {
    expect(checkTrip(null)).toBe('contract:body');
    expect(checkTrip([validTrip()])).toBe('contract:body');
  });
});

describe('verdictFor', () => {
  it('classifies unparseable bodies without throwing', () => {
    expect(verdictFor('<html>oops</html>')).toBe('not-json');
    expect(verdictFor('')).toBe('not-json');
  });
});

describe('CLI output safety', () => {
  const SENTINEL = 'SENTINEL-provider-output-7f3a';
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'trip-verdict-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (content: string) => {
    const file = path.join(dir, `body-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, content);
    return spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
  };

  it.each([
    ['a non-JSON body', `not json ${SENTINEL} {`, 'not-json', 2],
    ['a contract violation', JSON.stringify({ ...validTrip(), travelTime: SENTINEL }), 'contract:travelTime', 3],
    ['the fallback', JSON.stringify({ ...validTrip(), nudgeMessage: FALLBACK_NUDGE, costSavingsPerTrip: '2.50' }), 'fallback', 4],
  ])('prints only the fixed verdict for %s', (_label, content, verdict, code) => {
    const result = run(content);

    expect(result.status).toBe(code);
    expect(result.stdout).toBe(`${verdict}\n`);
    expect(result.stderr).toBe('');
    expect(result.stdout + result.stderr).not.toContain(SENTINEL);
  });

  it('prints ok and exits 0 for a valid body', () => {
    const result = run(JSON.stringify(validTrip()));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ok\n');
  });

  it('classifies a missing file as not-json without leaking the path error', () => {
    const result = spawnSync(process.execPath, [SCRIPT, path.join(dir, 'missing.json')], { encoding: 'utf8' });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('not-json\n');
    expect(result.stderr).toBe('');
  });
});
