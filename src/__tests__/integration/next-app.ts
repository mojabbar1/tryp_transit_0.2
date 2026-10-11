import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

/**
 * Process handling for `npm run test:integration`: one verified, offline production build, then one `next start` per
 * scenario, each on 127.0.0.1 with an OS-assigned port, a fixed environment, and the child guard preloaded. Only node
 * builtins here: Jest's global setup imports this file without the `@/` path mapping.
 */

export const SRC_DIR = path.resolve(__dirname, '..', '..');
const NEXT_BIN = path.join(SRC_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
const GUARD = path.join(__dirname, 'child-guard.cjs');
/** Test-only Google Fonts stylesheet for the build (see the file): no font is downloaded, none is committed. */
export const FONT_FIXTURE = path.join(__dirname, 'fixtures', 'google-fonts-offline.js');
/** Harness files the build runs with, outside the git-listed sources the fingerprint already covers. */
export const BUILD_HARNESS_INPUTS = [FONT_FIXTURE, GUARD];
/** Every proxy variable Node libraries or Turbopack's native (Rust) HTTP client read, pointed at the trap below. */
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
const BUILD_ID = path.join(SRC_DIR, '.next', 'BUILD_ID');
const BUILD_MARKER = path.join(SRC_DIR, '.next', 'integration-build.json');
export const BLOCK_MARKER = '[integration-network-guard] blocked';

const START_DEADLINE_MS = 60_000;
const STOP_DEADLINE_MS = 10_000;
const BUILD_DEADLINE_MS = 15 * 60_000;
const OUTPUT_LIMIT_CHARS = 2_000_000;

/**
 * The only variables a child inherits: what Node, npm and Next need to run. Nothing else crosses over, so a key, an
 * LLM or TomTom setting, a proxy, or DATA_AGENT_* in the caller's shell never reaches the app.
 */
const INHERITED = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'CI'];

/**
 * Every setting the app reads, pinned. Next.js loads `.env*` files from src/ (including a developer's `.env.local`),
 * but a variable already in the process environment wins, even when blank; so these blanks keep any local key or
 * setting out of the run, and `GET /api/health` confirms it (no LLM, no traffic configured).
 */
const PINNED_ENV: Record<string, string> = {
  NEXT_TELEMETRY_DISABLED: '1',
  // Inlined at build time: the build below sets it, and a change takes a rebuild (the marker records it).
  NEXT_PUBLIC_DEMO_MODE: 'false',
  LLM_PROVIDER: 'none',
  USE_GEMINI: '',
  GEMINI_API_KEY: '',
  OPENAI_API_KEY: '',
  GEMINI_MODEL: '',
  OPENAI_MODEL: '',
  LLM_TIMEOUT_MS: '8000',
  TOMTOM_API_KEY: '',
  NEXT_PUBLIC_TOMTOM_API_KEY: '',
  REGION_TIMEZONE: 'America/New_York',
  DATA_AGENT_ENABLED: 'false',
  DATA_AGENT_BASE_URL: '',
};

export function childEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const name of INHERITED) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  // NODE_ENV is left to Next (`build` and `start` set production), so the env is typed loosely here.
  return { ...env, ...PINNED_ENV, ...overrides } as unknown as NodeJS.ProcessEnv;
}

const guardOptions = (blockNetwork: boolean) => ({
  NODE_OPTIONS: `--require ${JSON.stringify(GUARD)}`,
  INTEGRATION_PARENT_PID: String(process.pid),
  INTEGRATION_BLOCK_NETWORK: blockNetwork ? '1' : '0',
});

/**
 * The build's environment: the pinned one, the child guard with the network blocked (as for the servers), Next's own
 * next/font/google test hook pointed at the offline fixture, and every proxy variable pointed at a loopback trap. The
 * guard covers Node code; the trap covers Turbopack's native HTTP client, which the guard can't see. Only this child
 * gets these: nothing is set in this process or in .env files, and next.config.mjs changes nothing unless
 * INTEGRATION_OFFLINE_BUILD=1, so `npm run build` is unchanged.
 */
export function buildEnv(proxyTrapUrl: string): NodeJS.ProcessEnv {
  const proxies = Object.fromEntries(PROXY_VARS.map((name) => [name, proxyTrapUrl]));
  return childEnv({
    ...guardOptions(true),
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: FONT_FIXTURE,
    // Read by next.config.mjs: no Turbopack persistent build cache, so a cached ordinary build can't replay its
    // Google Fonts request into this one, and this build's test font never enters the ordinary build's cache.
    INTEGRATION_OFFLINE_BUILD: '1',
    ...proxies,
  });
}

const BUILD_ARGS = ['build'];
const TRAP_PLACEHOLDER = 'http://127.0.0.1:<proxy-trap-port>';

/**
 * The build environment as the fingerprint sees it: exactly what buildEnv() sets, minus the variables inherited from
 * the machine and this run's pid, with checkout paths made relative. Any change to the build's settings (the font
 * hook, the guard, the proxies, a pinned value) is a different fingerprint, so a build made without them is not reused.
 */
export function buildSettings(): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const [name, value] of Object.entries(buildEnv(TRAP_PLACEHOLDER) as Record<string, string>)) {
    if (INHERITED.includes(name) || name === 'INTEGRATION_PARENT_PID') continue;
    settings[name] = value.split(SRC_DIR).join('<src>');
  }
  return settings;
}

export interface ProxyTrap {
  url: string;
  /** One entry per connection: the host (and port) it asked for, never a path or query; "?" if it sent no request. */
  attempts: string[];
  close(): Promise<void>;
}

const TARGET = /^(?:CONNECT\s+([^\s/]+)|[A-Z]+\s+[a-z][a-z0-9+.-]*:\/\/([^\s/?#]+))/i;

/**
 * A loopback listener posing as the HTTP(S) proxy. It records which host each connection wanted, answers 403 and
 * closes, so nothing is forwarded and a client that honours the proxy variables fails at once, visibly.
 */
export async function startProxyTrap(): Promise<ProxyTrap> {
  const attempts: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const index = attempts.push('?') - 1;
    let head = '';
    socket.setTimeout(5_000, () => socket.destroy());
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    const onData = (chunk: Buffer) => {
      head += chunk.toString('latin1');
      const lineEnd = head.indexOf('\r\n');
      if (lineEnd === -1 && head.length < 4_096) return;
      socket.off('data', onData);
      const match = TARGET.exec(head.slice(0, lineEnd === -1 ? 4_096 : lineEnd));
      // The host only: any userinfo before "@" is dropped, never logged.
      const host = (match?.[1] ?? match?.[2] ?? '').split('@').pop() ?? '';
      attempts[index] = host.replace(/[^\w.:[\]-]/g, '').slice(0, 255) || '?';
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    };
    socket.on('data', onData);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    attempts,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Stops one child this harness started (never anything else): SIGTERM, then SIGKILL after a deadline. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, STOP_DEADLINE_MS)) return;
  child.kill('SIGKILL');
  if (!(await waitForExit(child, STOP_DEADLINE_MS))) throw new Error(`pid ${child.pid} did not exit after SIGKILL`);
}

// ---------------------------------------------------------------------------------------------------------------
// Build: always `next build` with the pinned environment, unless a build this harness made is still current.

/**
 * A fingerprint of everything the build depends on: the content of every tracked or untracked (not ignored) file under
 * src/ outside __tests__/, the harness files the build runs with (the offline font fixture and the child guard), the
 * installed Next and Node versions, and the build's arguments and settings (buildSettings). Null without git.
 */
export function buildFingerprint(): string | null {
  let files: string[];
  try {
    files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: SRC_DIR, encoding: 'utf8' })
      .split('\0')
      .filter((file) => file && !file.startsWith('__tests__/'))
      .sort();
  } catch {
    return null;
  }
  const hash = createHash('sha256');
  const fileDigest = (absolute: string) => createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  for (const file of files) {
    const absolute = path.join(SRC_DIR, file);
    if (!fs.existsSync(absolute)) continue; // a deleted file still in the index
    hash.update(`${file}\0`).update(fileDigest(absolute)).update('\n');
  }
  // Read even if untracked or missing from git: a missing input throws here rather than fingerprinting nothing.
  for (const input of BUILD_HARNESS_INPUTS) hash.update(`harness:${path.relative(SRC_DIR, input)}\0`).update(fileDigest(input)).update('\n');
  const nextVersion = (JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'node_modules', 'next', 'package.json'), 'utf8')) as { version: string }).version;
  hash.update(JSON.stringify({ node: process.version, next: nextVersion, args: BUILD_ARGS, env: buildSettings() }));
  return hash.digest('hex');
}

function readBuildId(): string | null {
  try {
    return fs.readFileSync(BUILD_ID, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Why the existing build can't be reused, or null when it is verifiably this harness's build of the current sources. */
export function reuseRefusal(fingerprint: string | null): string | null {
  if (process.env.TEST_INTEGRATION_REBUILD === '1') return 'TEST_INTEGRATION_REBUILD=1';
  if (!fingerprint) return 'no source fingerprint (git unavailable)';
  const buildId = readBuildId();
  if (!buildId) return 'no production build in .next';
  let marker: { buildId?: string; fingerprint?: string };
  try {
    marker = JSON.parse(fs.readFileSync(BUILD_MARKER, 'utf8'));
  } catch {
    return 'the build in .next was not made by this harness';
  }
  if (marker.buildId !== buildId) return 'the build in .next changed since this harness made it';
  if (marker.fingerprint !== fingerprint) return 'sources, dependencies or build settings changed since the last harness build';
  return null;
}

export async function ensureProductionBuild(): Promise<void> {
  const fingerprint = buildFingerprint();
  const refusal = reuseRefusal(fingerprint);
  if (refusal === null) {
    console.log(`[integration] Reusing the verified production build ${readBuildId()} (unchanged sources and settings).`);
    return;
  }
  console.log(`[integration] Building the production app offline (next build): ${refusal}.`);
  // A failed or interrupted build must never leave a marker that a later run could take for a verified build.
  fs.rmSync(BUILD_MARKER, { force: true });
  const trap = await startProxyTrap();
  let blocked = false;
  let child: ChildProcess | undefined;
  let exit: number | string | null = null;
  try {
    child = spawn(process.execPath, [NEXT_BIN, ...BUILD_ARGS], { cwd: SRC_DIR, env: buildEnv(trap.url), stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = new Promise<void>((resolve) => {
      child?.once('close', () => resolve());
      child?.once('error', () => resolve());
    });
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]] as const) {
      let carry = '';
      stream?.setEncoding('utf8');
      stream?.on('data', (text: string) => {
        target.write(text);
        if ((carry + text).includes(BLOCK_MARKER)) blocked = true;
        carry = (carry + text).slice(-BLOCK_MARKER.length);
      });
    }
    let timer: NodeJS.Timeout | undefined;
    const finished = await Promise.race([
      closed.then(() => true),
      new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), BUILD_DEADLINE_MS))),
    ]);
    clearTimeout(timer);
    if (!finished) throw new Error(`next build did not finish within ${BUILD_DEADLINE_MS / 60_000} min`);
    exit = child.exitCode ?? child.signalCode;
  } finally {
    // Stops the build if it is still running (a deadline, or an error above); a no-op once it has exited.
    if (child) await stopChild(child);
    await trap.close();
  }
  if (blocked || trap.attempts.length > 0) {
    const reasons = [
      blocked ? 'the child guard blocked a connection (see the build output)' : '',
      trap.attempts.length > 0 ? `the proxy trap got ${trap.attempts.length} connection(s) for ${[...new Set(trap.attempts)].join(', ')}` : '',
    ].filter(Boolean);
    throw new Error(`next build tried to leave loopback: ${reasons.join('; ')}. The integration build must run offline; no marker was written.`);
  }
  if (exit !== 0) throw new Error(`next build failed (exit ${exit})`);
  const buildId = readBuildId();
  if (!buildId) throw new Error('next build finished without .next/BUILD_ID');
  if (fingerprint) fs.writeFileSync(BUILD_MARKER, `${JSON.stringify({ buildId, fingerprint, builtAt: new Date().toISOString() }, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------------------------
// One production server per scenario: its own process, so its env and in-memory caches start empty.

export interface NextApp {
  url: string;
  pid: number;
  /** Everything the server wrote to stdout and stderr so far. */
  output(): string;
  stop(): Promise<void>;
  exited(): boolean;
}

export interface DataAgentSettings {
  enabled: boolean;
  baseUrl: string;
}

export async function startNextApp(label: string, dataAgent: DataAgentSettings): Promise<NextApp> {
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: SRC_DIR,
    env: childEnv({
      ...guardOptions(true),
      DATA_AGENT_ENABLED: dataAgent.enabled ? 'true' : 'false',
      DATA_AGENT_BASE_URL: dataAgent.baseUrl,
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (child.pid === undefined) throw new Error(`[${label}] next start did not spawn`);
  let output = '';
  const append = (chunk: Buffer) => {
    if (output.length < OUTPUT_LIMIT_CHARS) output += chunk.toString('utf8');
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const tail = () => output.split('\n').slice(-40).join('\n');

  const fail = async (reason: string): Promise<never> => {
    await stopChild(child);
    throw new Error(`[${label}] ${reason}\n--- next start output (tail) ---\n${tail()}`);
  };

  const deadline = Date.now() + START_DEADLINE_MS;
  const url = await new Promise<string | null>((resolve) => {
    const check = () => {
      const match = /Local:\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) finish(match[1]);
    };
    const timer = setTimeout(() => finish(null), START_DEADLINE_MS);
    const onExit = () => finish(null);
    function finish(value: string | null) {
      clearTimeout(timer);
      child.stdout?.off('data', check);
      child.off('exit', onExit);
      resolve(value);
    }
    child.stdout?.on('data', check);
    child.once('exit', onExit);
    check();
  });
  if (!url) return fail(child.exitCode !== null ? `next start exited early (code ${child.exitCode})` : 'next start never reported its address');

  // Ready means the app answers: poll its health route until the same deadline, never on a fixed sleep.
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) return fail('next start exited before it was healthy');
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) break;
    } catch {
      // not accepting connections yet
    }
    if (Date.now() > deadline) return fail(`not healthy within ${START_DEADLINE_MS / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    url,
    pid: child.pid,
    output: () => output,
    stop: () => stopChild(child),
    exited: () => child.exitCode !== null || child.signalCode !== null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP helpers for the checks.

export interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
}

export async function httpRequest(base: string, pathname: string, init: { method?: string; json?: unknown } = {}): Promise<HttpResult> {
  const response = await fetch(`${base}${pathname}`, {
    method: init.method ?? 'GET',
    headers: init.json === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#x27': "'", '#39': "'" };

/**
 * The text a page shows: scripts, styles and comments removed, inline tags dropped (so "label: source" reads as
 * rendered), other tags turned into spaces, entities decoded, whitespace collapsed.
 */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:a|b|em|i|small|span|strong)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x27|#39|[a-z]+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}
