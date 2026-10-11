/**
 * The offline build behind `npm run test:integration` (next-app.ts): its test-only Google Fonts fixture, the build's
 * isolated environment and fingerprint, the loopback proxy trap, and the inert next.config hook. The build itself,
 * and its denial of every non-loopback connection, is exercised by `npm run test:integration`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BUILD_HARNESS_INPUTS,
  buildEnv,
  buildFingerprint,
  buildSettings,
  childEnv,
  FONT_FIXTURE,
  SRC_DIR,
  startProxyTrap,
} from './next-app';

const fixture = require('./fixtures/google-fonts-offline.js') as Record<string, string>;
const { getFontAxes } = require('next/dist/compiled/@next/font/dist/google/get-font-axes') as {
  getFontAxes(family: string, weights: string[], styles: string[], axes?: string[]): object;
};
const { getGoogleFontsUrl } = require('next/dist/compiled/@next/font/dist/google/get-google-fonts-url') as {
  getGoogleFontsUrl(family: string, axes: object, display: string): string;
};
const { findFontFilesInCss } = require('next/dist/compiled/@next/font/dist/google/find-font-files-in-css') as {
  findFontFilesInCss(css: string, subsets?: string[]): unknown[];
};

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
const HOOK_VARS = ['NEXT_FONT_GOOGLE_MOCKED_RESPONSES', 'INTEGRATION_OFFLINE_BUILD', ...PROXY_VARS];

describe('offline font fixture (test-only; not a typography check)', () => {
  test("is keyed by exactly the stylesheet URL Next computes for the layout's font call", () => {
    const layout = fs.readFileSync(path.join(SRC_DIR, 'app', 'layout.tsx'), 'utf8');
    const call = /Poppins\(\{\s*subsets:\s*\[[^\]]*\],\s*weight:\s*\[([^\]]*)\]\s*\}\)/.exec(layout);
    expect(call).not.toBeNull();
    const weights = [...(call?.[1] ?? '').matchAll(/'(\d+)'/g)].map((match) => match[1]);
    expect(weights).toEqual(['500', '900']);
    const url = getGoogleFontsUrl('Poppins', getFontAxes('Poppins', weights, [], undefined), 'swap');
    expect(Object.keys(fixture)).toEqual([url]);
  });

  test('names local faces only: nothing for Next to download, no remote URL', () => {
    const css = Object.values(fixture).join('\n');
    expect(findFontFilesInCss(css, ['latin'])).toEqual([]);
    expect(css).not.toMatch(/url\(|https?:|\/\//);
    for (const weight of ['500', '900']) expect(css).toContain(`font-weight: ${weight};`);
    expect(fs.readFileSync(FONT_FIXTURE, 'utf8')).toMatch(/TEST-ONLY[\s\S]*not typography/);
  });
});

describe('integration build environment', () => {
  const trapUrl = 'http://127.0.0.1:65000';

  test('the build gets the font hook, the network guard and the proxy trap; only through its own env', () => {
    const before = { ...process.env };
    const env = buildEnv(trapUrl);
    expect(process.env).toEqual(before);
    expect(env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES).toBe(FONT_FIXTURE);
    expect(env.INTEGRATION_OFFLINE_BUILD).toBe('1');
    expect(env.INTEGRATION_BLOCK_NETWORK).toBe('1');
    expect(env.NODE_OPTIONS).toContain('child-guard.cjs');
    for (const name of PROXY_VARS) expect(env[name]).toBe(trapUrl);
    expect(env.NO_PROXY).toBeUndefined();
    expect(env.no_proxy).toBeUndefined();
    for (const name of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'TOMTOM_API_KEY', 'NEXT_PUBLIC_TOMTOM_API_KEY']) expect(env[name]).toBe('');
    // Nothing is set in this process (so nothing reaches `npm run build`), and the servers' environment has none of it.
    for (const name of HOOK_VARS) expect(childEnv()[name]).toBeUndefined();
  });

  test('the fingerprint covers the build settings and the harness inputs, without machine paths or pids', () => {
    const settings = buildSettings();
    expect(settings.NEXT_FONT_GOOGLE_MOCKED_RESPONSES).toBe('<src>/__tests__/integration/fixtures/google-fonts-offline.js');
    expect(settings.INTEGRATION_OFFLINE_BUILD).toBe('1');
    expect(settings.INTEGRATION_BLOCK_NETWORK).toBe('1');
    expect(settings.HTTPS_PROXY).toBe('http://127.0.0.1:<proxy-trap-port>');
    for (const name of ['PATH', 'HOME', 'INTEGRATION_PARENT_PID']) expect(settings).not.toHaveProperty(name);
    expect(JSON.stringify(settings)).not.toContain(SRC_DIR);
    expect(BUILD_HARNESS_INPUTS).toEqual(expect.arrayContaining([FONT_FIXTURE, path.join(__dirname, 'child-guard.cjs')]));
    const fingerprint = buildFingerprint();
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(buildFingerprint()).toBe(fingerprint);
  });
});

describe('proxy trap', () => {
  /** Connects, sends `request` (if any), and resolves with whatever the trap answered before closing. */
  function exchange(url: string, request?: string): Promise<string> {
    const { port } = new URL(url);
    return new Promise((resolve, reject) => {
      const socket = net.connect(Number(port), '127.0.0.1', () => {
        if (request === undefined) socket.end();
        else socket.write(request);
      });
      let reply = '';
      socket.on('data', (chunk) => (reply += chunk.toString('latin1')));
      socket.on('error', reject);
      socket.on('close', () => resolve(reply));
    });
  }

  test('records the host each connection asked for (no path or query), refuses it, and forwards nothing', async () => {
    const trap = await startProxyTrap();
    try {
      expect(trap.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await exchange(trap.url, 'CONNECT fonts.googleapis.com:443 HTTP/1.1\r\nHost: fonts.googleapis.com:443\r\n\r\n')).toMatch(/^HTTP\/1\.1 403 /);
      expect(await exchange(trap.url, 'GET http://someone@example.test/a/path?q=hidden HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1\.1 403 /);
      await exchange(trap.url);
      expect(trap.attempts).toEqual(['fonts.googleapis.com:443', 'example.test', '?']);
      expect(trap.attempts.join(' ')).not.toMatch(/someone|path|hidden/);
    } finally {
      await trap.close();
    }
  });

  test('closes even with a connection still open', async () => {
    const trap = await startProxyTrap();
    const { port } = new URL(trap.url);
    const socket = net.connect(Number(port), '127.0.0.1');
    socket.on('error', () => undefined);
    await new Promise((resolve) => socket.once('connect', resolve));
    for (let i = 0; i < 100 && trap.attempts.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    await trap.close();
    expect(trap.attempts).toEqual(['?']);
  });
});

describe('next.config.mjs', () => {
  function loadConfig(env: Record<string, string>): unknown {
    const script = `import(${JSON.stringify(pathToFileURL(path.join(SRC_DIR, 'next.config.mjs')).href)}).then((m) => console.log(JSON.stringify(m.default)))`;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
      encoding: 'utf8',
    });
    return JSON.parse(output);
  }

  test('is unchanged for every build but the integration one, which only opts out of the persistent build cache', () => {
    expect(loadConfig({})).toEqual({});
    expect(loadConfig({ INTEGRATION_OFFLINE_BUILD: '0' })).toEqual({});
    expect(loadConfig({ INTEGRATION_OFFLINE_BUILD: '1' })).toEqual({ experimental: { turbopackFileSystemCacheForBuild: false } });
  });
});
