/**
 * Unit tests for scripts/lockfile-hosts.cjs
 */

import { createHash } from 'crypto';

const {
  canonicalizeLock,
  strengthenIntegrity,
  weakIntegrityEntries,
} = require('../../scripts/lockfile-hosts.cjs');

const FEED = 'https://ms-feed.example.test/_packaging/npm-public/npm/registry';
const CANON = 'https://registry.npmjs.org';

type LockfileEntry = { name?: string; version?: string; resolved?: string; integrity?: string };
type LockfileFixture = { lockfileVersion: number; packages: Record<string, LockfileEntry> };

function lockWith(packages: Record<string, LockfileEntry>): LockfileFixture {
  return { lockfileVersion: 3, packages: { '': { name: 'src' }, ...packages } };
}

const hash = (algo: string, bytes: Buffer) => `${algo}-${createHash(algo).update(bytes).digest('base64')}`;

describe('canonicalizeLock', () => {
  it('accepts exact canonical registry URLs', () => {
    const lock = lockWith({
      'node_modules/axios': { version: '1.20.0', resolved: `${CANON}/axios/-/axios-1.20.0.tgz`, integrity: 'sha512-a' },
      'node_modules/@emnapi/core': { version: '1.11.3', resolved: `${CANON}/@emnapi/core/-/core-1.11.3.tgz` },
    });

    expect(canonicalizeLock(lock, { fix: true })).toEqual({ rewritten: 0, offending: [] });
  });

  it('reports proxy URLs in check mode without modifying them', () => {
    const lock = lockWith({ 'node_modules/axios': { version: '1.20.0', resolved: `${FEED}/axios/-/axios-1.20.0.tgz` } });

    const result = canonicalizeLock(lock);

    expect(result.rewritten).toBe(0);
    expect(result.offending).toEqual([
      { key: 'node_modules/axios', host: 'ms-feed.example.test', reason: 'not on registry.npmjs.org' },
    ]);
    expect(lock.packages['node_modules/axios'].resolved).toBe(`${FEED}/axios/-/axios-1.20.0.tgz`);
  });

  it('rewrites unscoped, scoped, nested, and aliased entries whose full name and version match', () => {
    const lock = lockWith({
      'node_modules/axios': { version: '1.20.0', resolved: `${FEED}/axios/-/axios-1.20.0.tgz`, integrity: 'sha512-a' },
      'node_modules/@emnapi/core': { version: '1.11.3', resolved: `${FEED}/@emnapi/core/-/core-1.11.3.tgz` },
      'node_modules/eslint/node_modules/ajv': { version: '6.15.0', resolved: `${FEED}/ajv/-/ajv-6.15.0.tgz` },
      'node_modules/string-width-cjs': { name: 'string-width', version: '4.2.3', resolved: `${FEED}/string-width/-/string-width-4.2.3.tgz` },
    });

    expect(canonicalizeLock(lock, { fix: true })).toEqual({ rewritten: 4, offending: [] });
    expect(lock.packages['node_modules/axios']).toEqual({
      version: '1.20.0',
      resolved: `${CANON}/axios/-/axios-1.20.0.tgz`,
      integrity: 'sha512-a',
    });
    expect(lock.packages['node_modules/@emnapi/core'].resolved).toBe(`${CANON}/@emnapi/core/-/core-1.11.3.tgz`);
    expect(lock.packages['node_modules/eslint/node_modules/ajv'].resolved).toBe(`${CANON}/ajv/-/ajv-6.15.0.tgz`);
    expect(lock.packages['node_modules/string-width-cjs'].resolved).toBe(`${CANON}/string-width/-/string-width-4.2.3.tgz`);
  });

  it.each([
    ['a query string', `https://proxy.example.test/axios/-/axios-1.20.0.tgz?download=1`],
    ['a fragment', `https://proxy.example.test/axios/-/axios-1.20.0.tgz#x`],
    ['a nonstandard tarball path', `https://proxy.example.test/api/tarballs/axios-1.20.0.tgz`],
    ['a version mismatch', `${FEED}/axios/-/axios-9.9.9.tgz`],
    ['a parent-name mismatch', `${FEED}/other/-/axios-1.20.0.tgz`],
  ])('fails closed on an off-registry URL with %s, in both modes', (_label, url) => {
    for (const fix of [false, true]) {
      const lock = lockWith({ 'node_modules/axios': { version: '1.20.0', resolved: url } });

      const result = canonicalizeLock(lock, { fix });

      expect(result.rewritten).toBe(0);
      expect(result.offending).toHaveLength(1);
      expect(lock.packages['node_modules/axios'].resolved).toBe(url);
    }
  });

  it('refuses a scope mismatch instead of rewriting it to the entry name', () => {
    const url = `${FEED}/@different/core/-/core-1.20.0.tgz`;
    const lock = lockWith({ 'node_modules/@good/core': { version: '1.20.0', resolved: url } });

    const result = canonicalizeLock(lock, { fix: true });

    expect(result.rewritten).toBe(0);
    expect(result.offending[0].reason).toMatch(/cannot be mapped safely/);
    expect(lock.packages['node_modules/@good/core'].resolved).toBe(url);
  });

  it.each([
    ['an unscoped entry', 'node_modules/core', {}],
    ['a nested unscoped entry', 'node_modules/parent/node_modules/core', {}],
    ['an aliased entry', 'node_modules/alias', { name: 'core' }],
  ])('refuses a scoped source for %s with the same basename', (_label, key, extra) => {
    const url = 'https://proxy.example.test/@different/core/-/core-1.0.0.tgz';
    const lock = lockWith({ [key]: { version: '1.0.0', resolved: url, integrity: 'sha512-synthetic', ...extra } });

    const result = canonicalizeLock(lock, { fix: true });

    expect(result.rewritten).toBe(0);
    expect(result.offending).toHaveLength(1);
    expect(lock.packages[key].resolved).toBe(url);
  });

  it('still rewrites unscoped and scoped entries behind a multi-segment proxy prefix', () => {
    const lock = lockWith({
      'node_modules/core': { version: '1.0.0', resolved: `${FEED}/core/-/core-1.0.0.tgz` },
      'node_modules/@scope/core': { version: '1.0.0', resolved: `${FEED}/@scope/core/-/core-1.0.0.tgz` },
      'node_modules/@enc/pkg': { version: '2.0.0', resolved: `${FEED}/@enc%2fpkg/-/pkg-2.0.0.tgz` },
    });

    expect(canonicalizeLock(lock, { fix: true })).toEqual({ rewritten: 3, offending: [] });
    expect(lock.packages['node_modules/core'].resolved).toBe(`${CANON}/core/-/core-1.0.0.tgz`);
    expect(lock.packages['node_modules/@scope/core'].resolved).toBe(`${CANON}/@scope/core/-/core-1.0.0.tgz`);
    expect(lock.packages['node_modules/@enc/pkg'].resolved).toBe(`${CANON}/@enc/pkg/-/pkg-2.0.0.tgz`);
  });

  it('flags a registry.npmjs.org URL that is not exactly canonical', () => {
    const lock = lockWith({ 'node_modules/axios': { version: '1.20.0', resolved: `${CANON}/axios/-/axios-1.20.0.tgz?x=1` } });

    expect(canonicalizeLock(lock, { fix: true }).offending[0].reason).toMatch(/non-canonical registry URL/);
  });

  it('leaves git, file, and link sources alone in both modes', () => {
    const sources = {
      'node_modules/git-dep': { version: '1.0.0', resolved: 'git+ssh://git@github.com/org/repo.git#abc123' },
      'node_modules/vendored': { version: '1.20.0', resolved: 'file:../vendor/-/axios-1.20.0.tgz' },
      'node_modules/linked': { version: '0.0.0', resolved: 'link:../pkg' },
    };
    for (const fix of [false, true]) {
      const lock = lockWith(JSON.parse(JSON.stringify(sources)));

      expect(canonicalizeLock(lock, { fix })).toEqual({ rewritten: 0, offending: [] });
      expect(lock.packages['node_modules/vendored'].resolved).toBe('file:../vendor/-/axios-1.20.0.tgz');
    }
  });

  it('fails closed on unsupported schemes', () => {
    const lock = lockWith({ 'node_modules/axios': { version: '1.20.0', resolved: 'ftp://proxy.example.test/axios/-/axios-1.20.0.tgz' } });

    expect(canonicalizeLock(lock, { fix: true }).offending[0].reason).toMatch(/unsupported source scheme/);
  });
});

describe('strengthenIntegrity', () => {
  const bytes = Buffer.from('fake tarball bytes');
  const okFetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }));

  beforeEach(() => okFetch.mockClear());

  it('lists only registry entries without a sha512 hash', () => {
    const lock = lockWith({
      'node_modules/a': { version: '1.0.0', resolved: `${CANON}/a/-/a-1.0.0.tgz`, integrity: hash('sha1', bytes) },
      'node_modules/b': { version: '1.0.0', resolved: `${CANON}/b/-/b-1.0.0.tgz`, integrity: hash('sha512', bytes) },
      'node_modules/c': { version: '1.0.0', resolved: 'git+ssh://git@github.com/org/c.git#1', integrity: 'sha1-x' },
    });

    expect(weakIntegrityEntries(lock).map(([key]: [string]) => key)).toEqual(['node_modules/a']);
  });

  it('downloads through the configured registry, verifies the sha1, and records sha512', async () => {
    const lock = lockWith({ 'node_modules/@scope/a': { version: '1.0.0', resolved: `${CANON}/@scope/a/-/a-1.0.0.tgz`, integrity: hash('sha1', bytes) } });

    const result = await strengthenIntegrity(lock, { registry: 'https://proxy.example.test/npm', fetchImpl: okFetch });

    expect(result).toEqual({ upgraded: 1, offending: [] });
    expect(okFetch).toHaveBeenCalledWith('https://proxy.example.test/npm/@scope/a/-/a-1.0.0.tgz');
    expect(lock.packages['node_modules/@scope/a'].integrity).toBe(hash('sha512', bytes));
    expect(lock.packages['node_modules/@scope/a'].resolved).toBe(`${CANON}/@scope/a/-/a-1.0.0.tgz`);
  });

  it('refuses to record sha512 when the downloaded bytes do not match the recorded hash', async () => {
    const recorded = hash('sha1', Buffer.from('different bytes'));
    const lock = lockWith({ 'node_modules/a': { version: '1.0.0', resolved: `${CANON}/a/-/a-1.0.0.tgz`, integrity: recorded } });

    const result = await strengthenIntegrity(lock, { registry: CANON, fetchImpl: okFetch });

    expect(result.upgraded).toBe(0);
    expect(result.offending[0].reason).toMatch(/does not match the recorded sha1/);
    expect(lock.packages['node_modules/a'].integrity).toBe(recorded);
  });

  it('reports a failed download without changing the entry', async () => {
    const lock = lockWith({ 'node_modules/a': { version: '1.0.0', resolved: `${CANON}/a/-/a-1.0.0.tgz`, integrity: hash('sha1', bytes) } });
    const failing = jest.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));

    const result = await strengthenIntegrity(lock, { registry: CANON, fetchImpl: failing });

    expect(result).toEqual({ upgraded: 0, offending: [expect.objectContaining({ reason: 'tarball download failed (HTTP 404)' })] });
    expect(lock.packages['node_modules/a'].integrity).toBe(hash('sha1', bytes));
  });
});
