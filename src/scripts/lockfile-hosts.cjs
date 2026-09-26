#!/usr/bin/env node
/**
 * Keep package-lock.json canonical: every registry tarball resolves from registry.npmjs.org and
 * carries a sha512 integrity hash.
 *
 * Installs through a registry proxy can record the proxy's tarball URLs (leaking internal hostnames
 * into this public repo) and, when the proxy's metadata omits `dist.integrity`, only a sha1 hash.
 *
 *   check (default)  report off-registry, non-canonical, or sha1-only registry entries; exit 1 if any
 *   --fix            rewrite off-registry URLs that map unambiguously to the canonical
 *                    https://registry.npmjs.org/<name>/-/<file>.tgz (full name and version must match;
 *                    no query or fragment), and upgrade sha1-only integrity by downloading the tarball
 *                    through the configured registry, verifying it against the recorded hash, and
 *                    recording its sha512. Anything that can't be mapped or verified fails closed.
 * git/file/link sources are left alone.
 *
 * Usage (from src/): npm run lockfile:check | npm run lockfile:fix
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CANONICAL = 'https://registry.npmjs.org/';
const NON_REGISTRY = /^(git\+|git:|github:|gitlab:|bitbucket:|file:|link:)/;

function packageName(key, entry) {
  if (entry.name) return entry.name;
  const marker = 'node_modules/';
  return key.slice(key.lastIndexOf(marker) + marker.length);
}

function canonicalUrl(name, version) {
  return `${CANONICAL}${name}/-/${name.split('/').pop()}-${version}.tgz`;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
}

/**
 * Check (and with fix: true, rewrite in place) the `resolved` URLs of a parsed lockfile.
 * Returns { rewritten, offending }; offending lists entries that are still non-canonical.
 */
function canonicalizeLock(lock, { fix = false } = {}) {
  let rewritten = 0;
  const offending = [];
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    const url = entry && entry.resolved;
    if (!key || !url || NON_REGISTRY.test(url)) continue;
    const report = (reason) => offending.push({ key, host: hostOf(url), reason });

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      report('unparseable resolved URL');
      continue;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      report(`unsupported source scheme ${parsed.protocol}`);
      continue;
    }

    const name = packageName(key, entry);
    const canonical = canonicalUrl(name, entry.version);
    if (url === canonical) continue;
    if (url.startsWith(CANONICAL)) {
      report(`non-canonical registry URL (expected ${canonical})`);
      continue;
    }

    const suffix = `/${name}/-/${name.split('/').pop()}-${entry.version}.tgz`;
    const mappable = !parsed.search && !parsed.hash && parsed.pathname.endsWith(suffix);
    if (!mappable) {
      report(`off-registry URL that cannot be mapped safely (expected a path ending ${suffix})`);
      continue;
    }
    if (fix) {
      entry.resolved = canonical;
      rewritten += 1;
    } else {
      report('not on registry.npmjs.org');
    }
  }
  return { rewritten, offending };
}

function strongestHash(integrity) {
  const tokens = String(integrity || '').split(/\s+/).filter(Boolean);
  for (const algo of ['sha512', 'sha384', 'sha256', 'sha1']) {
    const token = tokens.find((t) => t.startsWith(`${algo}-`));
    if (token) return { algo, digest: token.slice(algo.length + 1) };
  }
  return null;
}

/** Registry tarball entries whose integrity lacks a sha512 hash. */
function weakIntegrityEntries(lock) {
  return Object.entries(lock.packages || {}).filter(
    ([key, entry]) =>
      key && entry && typeof entry.resolved === 'string' && entry.resolved.startsWith(CANONICAL) &&
      !String(entry.integrity || '').includes('sha512-')
  );
}

/**
 * Upgrade sha1-only (or other non-sha512) integrity to sha512. Each tarball is downloaded through
 * `registry` (the path after registry.npmjs.org/ is kept), verified against the strongest recorded
 * hash, and only then given its sha512. Returns { upgraded, offending }.
 */
async function strengthenIntegrity(lock, { registry, fetchImpl = globalThis.fetch, concurrency = 8 }) {
  const base = registry.endsWith('/') ? registry : `${registry}/`;
  const queue = weakIntegrityEntries(lock);
  const offending = [];
  let upgraded = 0;

  async function upgrade([key, entry]) {
    const recorded = strongestHash(entry.integrity);
    if (!recorded) {
      offending.push({ key, host: hostOf(entry.resolved), reason: 'no integrity to verify against' });
      return;
    }
    const url = base + entry.resolved.slice(CANONICAL.length);
    let bytes;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      offending.push({ key, host: hostOf(url), reason: `tarball download failed (${err.message})` });
      return;
    }
    const actual = crypto.createHash(recorded.algo).update(bytes).digest('base64');
    if (actual !== recorded.digest) {
      offending.push({ key, host: hostOf(url), reason: `downloaded tarball does not match the recorded ${recorded.algo}` });
      return;
    }
    entry.integrity = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
    upgraded += 1;
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await upgrade(queue.shift());
  });
  await Promise.all(workers);
  return { upgraded, offending };
}

async function main(argv) {
  const fix = argv.includes('--fix');
  const lockPath = path.join(__dirname, '..', 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

  const hosts = canonicalizeLock(lock, { fix });
  let offending = hosts.offending;
  let upgraded = 0;

  if (fix && offending.length === 0) {
    const registry = process.env.npm_config_registry || CANONICAL;
    const result = await strengthenIntegrity(lock, { registry });
    upgraded = result.upgraded;
    offending = result.offending;
  } else if (!fix) {
    for (const [key, entry] of weakIntegrityEntries(lock)) {
      offending.push({ key, host: hostOf(entry.resolved), reason: 'integrity has no sha512 hash' });
    }
  }

  if (fix && (hosts.rewritten > 0 || upgraded > 0)) {
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`lockfile-hosts: rewrote ${hosts.rewritten} URL(s); upgraded ${upgraded} integrity hash(es) to sha512`);
  }
  if (offending.length > 0) {
    console.error(`lockfile-hosts: ${offending.length} lockfile entr${offending.length === 1 ? 'y needs' : 'ies need'} attention`);
    for (const o of offending.slice(0, 20)) console.error(`  ${o.key} (${o.host}): ${o.reason}`);
    if (!fix) console.error('Run `npm run lockfile:fix` in src/ and commit the result.');
    return 1;
  }
  console.log(`lockfile-hosts: OK, every registry tarball resolves from ${CANONICAL} with sha512 integrity`);
  return 0;
}

module.exports = { canonicalizeLock, strengthenIntegrity, weakIntegrityEntries };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`lockfile-hosts: ${err.message}`);
      process.exitCode = 1;
    }
  );
}
