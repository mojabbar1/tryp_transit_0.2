/**
 * Regression (#14 review): the real SDKs, with debug logging requested, must not print a credential from a failed
 * request before the adapter reduces it to a reason code. Transport is stubbed; nothing leaves the process.
 */

import { z } from 'zod/v4';
import { createGeminiProvider } from '@/lib/llm/gemini';
import { createOpenAiProvider } from '@/lib/llm/openai';
import { LlmError, toJsonSchema } from '@/lib/llm/shared';

const schema = z.object({ nudge: z.string(), slots: z.array(z.string()) }).strict();
const request = { system: 'sys', user: 'facts', schema, jsonSchema: toJsonSchema(schema), timeoutMs: 2000 };
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;

let printed: string[];
const savedFetch = globalThis.fetch;
const savedLog = process.env.OPENAI_LOG;

beforeEach(() => {
  printed = [];
  for (const level of LEVELS) {
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      printed.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    });
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  globalThis.fetch = savedFetch;
  if (savedLog === undefined) delete process.env.OPENAI_LOG;
  else process.env.OPENAI_LOG = savedLog;
});

const failingFetch = (secret: string) =>
  jest.fn(async () => {
    throw new TypeError(`fetch failed: connect ECONNREFUSED (request carried ${secret})`);
  }) as unknown as typeof fetch;

it.each([
  ['OpenAI', 'placeholder-openai-credential', (key: string) => createOpenAiProvider(key, 'gpt-5.6-terra')],
  ['Gemini', 'placeholder-gemini-credential', (key: string) => createGeminiProvider(key, 'gemini-3.8-flash')],
])('%s: a failed request with debug logging prints no credential and returns a reason code', async (_name, secret, make) => {
  process.env.OPENAI_LOG = 'debug';
  globalThis.fetch = failingFetch(secret);
  const provider = make(secret);

  const error = await provider.generateJson(request).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(LlmError);
  expect((error as LlmError).reason).toBe('llm_request_failed');
  expect((globalThis.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  expect(printed.join('\n')).not.toContain(secret);
});
