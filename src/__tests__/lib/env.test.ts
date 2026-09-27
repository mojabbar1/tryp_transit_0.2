/**
 * Tests for src/lib/env.ts (P1 T2). Every key below is a placeholder, never a real secret.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { inspect } from 'util';
import { parseEnv } from '@/lib/env';

const GEMINI_KEY = 'placeholder-gemini-value';
const OPENAI_KEY = 'placeholder-openai-value';
const TOMTOM_KEY = 'placeholder-tomtom-value';
const LEGACY_TOMTOM_KEY = 'placeholder-legacy-tomtom-value';

const thrown = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a throw');
};

describe('parseEnv', () => {
  it('applies the defaults, and with no keys the provider is none', () => {
    const env = parseEnv({});
    expect(env).toEqual({
      llmProvider: 'none',
      geminiModel: 'gemini-3.8-flash',
      openaiModel: 'gpt-5.6-terra',
      llmTimeoutMs: 8000,
      regionTimezone: 'America/New_York',
      dataAgentBaseUrl: undefined,
    });
    expect([env.geminiApiKey, env.openaiApiKey, env.tomtomApiKey]).toEqual([undefined, undefined, undefined]);
  });

  it.each([
    ['USE_GEMINI=true with a Gemini key', { USE_GEMINI: 'true', GEMINI_API_KEY: GEMINI_KEY }, 'gemini'],
    ['USE_GEMINI unset selects OpenAI, as the P0 route does', { OPENAI_API_KEY: OPENAI_KEY }, 'openai'],
    ['USE_GEMINI=false selects OpenAI', { USE_GEMINI: 'false', GEMINI_API_KEY: GEMINI_KEY, OPENAI_API_KEY: OPENAI_KEY }, 'openai'],
    ['a selected provider without a key is none, never a silent switch', { USE_GEMINI: 'true', OPENAI_API_KEY: OPENAI_KEY }, 'none'],
    ['LLM_PROVIDER overrides USE_GEMINI', { LLM_PROVIDER: 'openai', USE_GEMINI: 'true', GEMINI_API_KEY: GEMINI_KEY, OPENAI_API_KEY: OPENAI_KEY }, 'openai'],
    ['LLM_PROVIDER=gemini without a Gemini key is none', { LLM_PROVIDER: 'gemini', OPENAI_API_KEY: OPENAI_KEY }, 'none'],
    ['LLM_PROVIDER=none wins even with keys', { LLM_PROVIDER: 'none', USE_GEMINI: 'true', GEMINI_API_KEY: GEMINI_KEY }, 'none'],
    ['a blank LLM_PROVIDER falls back to USE_GEMINI', { LLM_PROVIDER: '  ', USE_GEMINI: 'true', GEMINI_API_KEY: GEMINI_KEY }, 'gemini'],
    ['a blank key counts as missing', { USE_GEMINI: 'true', GEMINI_API_KEY: '   ' }, 'none'],
  ])('provider: %s', (_label, source, expected) => {
    expect(parseEnv(source).llmProvider).toBe(expected);
  });

  it('trims model overrides and treats blanks as unset', () => {
    const env = parseEnv({ GEMINI_MODEL: '  gemini-override ', OPENAI_MODEL: '' });
    expect([env.geminiModel, env.openaiModel]).toEqual(['gemini-override', 'gpt-5.6-terra']);
  });

  it('reads the timeout, time zone, and data-agent URL', () => {
    const env = parseEnv({ LLM_TIMEOUT_MS: '5000', REGION_TIMEZONE: 'America/Chicago', DATA_AGENT_BASE_URL: 'http://localhost:8000' });
    expect([env.llmTimeoutMs, env.regionTimezone, env.dataAgentBaseUrl]).toEqual([5000, 'America/Chicago', 'http://localhost:8000']);
  });

  it.each([
    ['LLM_PROVIDER', 'claude'],
    ['LLM_TIMEOUT_MS', 'abc'],
    ['LLM_TIMEOUT_MS', '0'],
    ['LLM_TIMEOUT_MS', '1.5'],
    ['LLM_TIMEOUT_MS', '60001'],
    ['REGION_TIMEZONE', 'Mars/Olympus_Mons'],
    ['DATA_AGENT_BASE_URL', 'javascript:alert(1)'],
    ['DATA_AGENT_BASE_URL', 'not a url'],
  ])('rejects an invalid %s (%p) by name', (name, value) => {
    expect(thrown(() => parseEnv({ [name]: value }))).toBe(`Invalid server environment: ${name}`);
  });

  it('prefers TOMTOM_API_KEY and falls back to the legacy NEXT_PUBLIC_ name', () => {
    expect(parseEnv({ TOMTOM_API_KEY: TOMTOM_KEY, NEXT_PUBLIC_TOMTOM_API_KEY: LEGACY_TOMTOM_KEY }).tomtomApiKey).toBe(TOMTOM_KEY);
    expect(parseEnv({ NEXT_PUBLIC_TOMTOM_API_KEY: LEGACY_TOMTOM_KEY }).tomtomApiKey).toBe(LEGACY_TOMTOM_KEY);
  });

  it('warns once, without the value, when only the legacy TomTom name is set', async () => {
    await jest.isolateModulesAsync(async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { parseEnv: fresh } = await import('@/lib/env');
      fresh({ TOMTOM_API_KEY: TOMTOM_KEY, NEXT_PUBLIC_TOMTOM_API_KEY: LEGACY_TOMTOM_KEY });
      expect(warn).not.toHaveBeenCalled();
      fresh({ NEXT_PUBLIC_TOMTOM_API_KEY: LEGACY_TOMTOM_KEY });
      fresh({ NEXT_PUBLIC_TOMTOM_API_KEY: LEGACY_TOMTOM_KEY });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('rename it to TOMTOM_API_KEY');
      expect(String(warn.mock.calls[0][0])).not.toContain(LEGACY_TOMTOM_KEY);
      warn.mockRestore();
    });
  });

  it('keeps secrets readable but out of JSON, console output, and key listings', () => {
    const env = parseEnv({ USE_GEMINI: 'true', GEMINI_API_KEY: GEMINI_KEY, OPENAI_API_KEY: OPENAI_KEY, TOMTOM_API_KEY: TOMTOM_KEY });
    expect([env.geminiApiKey, env.openaiApiKey, env.tomtomApiKey]).toEqual([GEMINI_KEY, OPENAI_KEY, TOMTOM_KEY]);
    for (const printed of [JSON.stringify(env), inspect(env), Object.keys(env).join(',')]) {
      for (const secret of [GEMINI_KEY, OPENAI_KEY, TOMTOM_KEY]) expect(printed).not.toContain(secret);
    }
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('never echoes a value in a validation error', () => {
    const message = thrown(() => parseEnv({ GEMINI_API_KEY: GEMINI_KEY, LLM_PROVIDER: GEMINI_KEY }));
    expect(message).toBe('Invalid server environment: LLM_PROVIDER');
    expect(message).not.toContain(GEMINI_KEY);
  });
});

describe('getEnv', () => {
  const saved = process.env.LLM_TIMEOUT_MS;
  afterEach(() => {
    if (saved === undefined) delete process.env.LLM_TIMEOUT_MS;
    else process.env.LLM_TIMEOUT_MS = saved;
  });

  it('reads nothing at import time, then parses once and caches', async () => {
    await jest.isolateModulesAsync(async () => {
      process.env.LLM_TIMEOUT_MS = 'not-a-number';
      const { getEnv } = await import('@/lib/env');
      expect(() => getEnv()).toThrow('Invalid server environment: LLM_TIMEOUT_MS');
      process.env.LLM_TIMEOUT_MS = '1234';
      const first = getEnv();
      process.env.LLM_TIMEOUT_MS = '5678';
      expect(getEnv()).toBe(first);
      expect(first.llmTimeoutMs).toBe(1234);
    });
  });
});

describe('env.ts source', () => {
  const source = readFileSync(join(__dirname, '../../lib/env.ts'), 'utf8');

  it('is guarded by server-only as its first import', () => {
    expect(source.split('\n').find((line) => line.startsWith('import '))).toBe("import 'server-only';");
  });

  it('does not read the client-side demo flag', () => {
    expect(source).not.toContain('process.env.NEXT_PUBLIC_DEMO_MODE');
  });
});
