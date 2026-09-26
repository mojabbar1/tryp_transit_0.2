#!/usr/bin/env node
/**
 * Keep package-lock.json on the public npm registry.
 *
 * Installs through a registry proxy record the proxy's tarball URLs in `resolved`. That leaks
 * internal hostnames into this public repo and ties installs to the proxy. `check` (default)
 * lists such entries and exits 1; `--fix` rewrites them to the canonical registry.npmjs.org URL
 * derived from the package name and version. Integrity hashes are untouched (same tarball).
 *
 * Usage (from src/): npm run lockfile:check | npm run lockfile:fix
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CANONICAL = 'https://registry.npmjs.org/';
const TARBALL = /\/-\/[^/]+\.tgz$/;

function packageName(key, entry) {
  if (entry.name) return entry.name;
  const marker = 'node_modules/';
  return key.slice(key.lastIndexOf(marker) + marker.length);
}

/**
 * Inspect (and optionally rewrite) the `resolved` URLs of a parsed lockfile in place.
 * Only registry tarball URLs are considered; git/file/local entries are left alone.
 * Returns { rewritten, offending }, where offending lists entries still off the canonical host.
 */
function canonicalizeLock(lock, { fix = false } = {}) {
  let rewritten = 0;
  const offending = [];
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    const url = entry && entry.resolved;
    if (!key || !url || url.startsWith(CANONICAL) || !TARBALL.test(url)) continue;
    const name = packageName(key, entry);
    const file = `${name.split('/').pop()}-${entry.version}.tgz`;
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // keep the raw value for the report
    }
    if (!url.endsWith(`/${file}`)) {
      offending.push({ key, host, reason: `cannot map safely (expected .../${file})` });
      continue;
    }
    if (fix) {
      entry.resolved = `${CANONICAL}${name}/-/${file}`;
      rewritten += 1;
    } else {
      offending.push({ key, host, reason: 'not on registry.npmjs.org' });
    }
  }
  return { rewritten, offending };
}

function main(argv) {
  const fix = argv.includes('--fix');
  const lockPath = path.join(__dirname, '..', 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const { rewritten, offending } = canonicalizeLock(lock, { fix });

  if (fix && rewritten > 0) {
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`lockfile-hosts: rewrote ${rewritten} resolved URL(s) to ${CANONICAL}`);
  }
  if (offending.length > 0) {
    console.error(`lockfile-hosts: ${offending.length} resolved URL(s) not on ${CANONICAL}`);
    for (const o of offending.slice(0, 20)) console.error(`  ${o.key} (${o.host}): ${o.reason}`);
    if (!fix) console.error('Run `npm run lockfile:fix` in src/ and commit the result.');
    return 1;
  }
  console.log(`lockfile-hosts: OK, every registry tarball resolves from ${CANONICAL}`);
  return 0;
}

module.exports = { canonicalizeLock };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
