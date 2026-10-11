import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Process handling for `npm run test:integration`: one verified production build, then one `next start` per scenario,
 * each on 127.0.0.1 with an OS-assigned port, a fixed environment, and the child guard preloaded. Only node builtins
 * here: Jest's global setup imports this file without the `@/` path mapping.
 */

export const SRC_DIR = path.resolve(__dirname, '..', '..');
const NEXT_BIN = path.join(SRC_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
const GUARD = path.join(__dirname, 'child-guard.cjs');
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
 * src/ outside __tests__/, the installed Next and Node versions, and the pinned build environment. Null without git.
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
  for (const file of files) {
    const absolute = path.join(SRC_DIR, file);
    if (!fs.existsSync(absolute)) continue; // a deleted file still in the index
    hash.update(`${file}\0`).update(createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')).update('\n');
  }
  const nextVersion = (JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'node_modules', 'next', 'package.json'), 'utf8')) as { version: string }).version;
  hash.update(JSON.stringify({ node: process.version, next: nextVersion, env: PINNED_ENV }));
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
  console.log(`[integration] Building the production app (next build): ${refusal}.`);
  // The build itself may fetch the Google font the layout uses, so only the parent watch applies here.
  const child = spawn(process.execPath, [NEXT_BIN, 'build'], {
    cwd: SRC_DIR,
    env: childEnv(guardOptions(false)),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const exited = await waitForExit(child, BUILD_DEADLINE_MS);
  if (!exited) {
    await stopChild(child);
    throw new Error(`next build did not finish within ${BUILD_DEADLINE_MS / 60_000} min`);
  }
  if (child.exitCode !== 0) throw new Error(`next build failed (exit ${child.exitCode ?? child.signalCode})`);
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
