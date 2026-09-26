/**
 * Unit tests for scripts/lockfile-hosts.cjs
 */

const { canonicalizeLock } = require('../../scripts/lockfile-hosts.cjs');

export {};

const FEED = 'https://ms-feed.example.test/_packaging/npm-public/npm/registry';

type LockfileEntry = { name?: string; version?: string; resolved?: string; integrity?: string };
type LockfileFixture = { lockfileVersion: number; packages: Record<string, LockfileEntry> };

function lockWith(packages: Record<string, LockfileEntry>): LockfileFixture {
  return { lockfileVersion: 3, packages: { '': { name: 'src' }, ...packages } };
}

describe('canonicalizeLock', () => {
  it('leaves canonical registry URLs untouched', () => {
    const lock = lockWith({
      'node_modules/axios': { version: '1.20.0', resolved: 'https://registry.npmjs.org/axios/-/axios-1.20.0.tgz', integrity: 'sha512-a' },
    });

    const result = canonicalizeLock(lock, { fix: true });

    expect(result).toEqual({ rewritten: 0, offending: [] });
    expect(lock.packages['node_modules/axios'].resolved).toBe('https://registry.npmjs.org/axios/-/axios-1.20.0.tgz');
  });

  it('reports proxy URLs in check mode without modifying them', () => {
    const lock = lockWith({
      'node_modules/axios': { version: '1.20.0', resolved: `${FEED}/axios/-/axios-1.20.0.tgz` },
    });

    const result = canonicalizeLock(lock);

    expect(result.rewritten).toBe(0);
    expect(result.offending).toEqual([
      { key: 'node_modules/axios', host: 'ms-feed.example.test', reason: 'not on registry.npmjs.org' },
    ]);
    expect(lock.packages['node_modules/axios'].resolved).toBe(`${FEED}/axios/-/axios-1.20.0.tgz`);
  });

  it('rewrites unscoped, scoped, and nested entries to canonical URLs, keeping integrity', () => {
    const lock = lockWith({
      'node_modules/axios': { version: '1.20.0', resolved: `${FEED}/axios/-/axios-1.20.0.tgz`, integrity: 'sha512-a' },
      'node_modules/@emnapi/core': { version: '1.11.3', resolved: `${FEED}/@emnapi/core/-/core-1.11.3.tgz` },
      'node_modules/eslint/node_modules/ajv': { version: '6.15.0', resolved: `${FEED}/ajv/-/ajv-6.15.0.tgz` },
    });

    const result = canonicalizeLock(lock, { fix: true });

    expect(result).toEqual({ rewritten: 3, offending: [] });
    expect(lock.packages['node_modules/axios']).toEqual({
      version: '1.20.0',
      resolved: 'https://registry.npmjs.org/axios/-/axios-1.20.0.tgz',
      integrity: 'sha512-a',
    });
    expect(lock.packages['node_modules/@emnapi/core'].resolved).toBe(
      'https://registry.npmjs.org/@emnapi/core/-/core-1.11.3.tgz'
    );
    expect(lock.packages['node_modules/eslint/node_modules/ajv'].resolved).toBe(
      'https://registry.npmjs.org/ajv/-/ajv-6.15.0.tgz'
    );
  });

  it('uses the real package name for aliased entries', () => {
    const lock = lockWith({
      'node_modules/string-width-cjs': {
        name: 'string-width',
        version: '4.2.3',
        resolved: `${FEED}/string-width/-/string-width-4.2.3.tgz`,
      },
    });

    canonicalizeLock(lock, { fix: true });

    expect(lock.packages['node_modules/string-width-cjs'].resolved).toBe(
      'https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz'
    );
  });

  it('refuses to rewrite a URL whose file name does not match the name and version', () => {
    const lock = lockWith({
      'node_modules/axios': { version: '1.20.0', resolved: `${FEED}/axios/-/axios-9.9.9.tgz` },
    });

    const result = canonicalizeLock(lock, { fix: true });

    expect(result.rewritten).toBe(0);
    expect(result.offending).toHaveLength(1);
    expect(result.offending[0].reason).toMatch(/cannot map safely/);
    expect(lock.packages['node_modules/axios'].resolved).toBe(`${FEED}/axios/-/axios-9.9.9.tgz`);
  });

  it('ignores non-tarball sources such as git dependencies', () => {
    const lock = lockWith({
      'node_modules/some-git-dep': { version: '1.0.0', resolved: 'git+ssh://git@github.com/org/repo.git#abc123' },
    });

    expect(canonicalizeLock(lock, { fix: true })).toEqual({ rewritten: 0, offending: [] });
  });
});
