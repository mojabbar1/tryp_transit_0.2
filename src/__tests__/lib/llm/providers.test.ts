/**
 * LLM seam: provider selection, the two SDK adapters, and the shared fail-closed helpers (P1c T5).
 * Keys below are placeholders; both SDKs are mocked, so nothing leaves the process.
 */

const mockGenerate = jest.fn();
const mockCreate = jest.fn();

jest.mock('@google/genai', () => ({
  FinishReason: { STOP: 'STOP', MAX_TOKENS: 'MAX_TOKENS' },
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: (...args: unknown[]) => mockGenerate(...args) } })),
}));
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ responses: { create: (...args: unknown[]) => mockCreate(...args) } })),
}));

import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { z } from 'zod/v4';
import { parseEnv } from '@/lib/env';
import { createGeminiProvider } from '@/lib/llm/gemini';
import { createOpenAiProvider } from '@/lib/llm/openai';
import { getProvider } from '@/lib/llm/provider';
import { LlmError, parseJsonOutput, toJsonSchema, withTimeout } from '@/lib/llm/shared';

const schema = z.object({ nudge: z.string(), slots: z.array(z.string()) }).strict();
const request = { system: 'sys', user: 'facts', schema, jsonSchema: toJsonSchema(schema), timeoutMs: 1000 };
const valid = { nudge: 'Consider transit.', slots: [] };

const reason = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof LlmError ? error.reason : `not an LlmError: ${String(error)}`;
  }
  return 'resolved';
};

beforeEach(() => {
  mockGenerate.mockReset();
  mockCreate.mockReset();
});

describe('getProvider', () => {
  it('returns null for none, and for a selected provider without a key', () => {
    expect(getProvider(parseEnv({}))).toBeNull();
    expect(getProvider(parseEnv({ LLM_PROVIDER: 'none', GEMINI_API_KEY: 'placeholder' }))).toBeNull();
    expect(getProvider(parseEnv({ LLM_PROVIDER: 'gemini', OPENAI_API_KEY: 'placeholder' }))).toBeNull();
  });

  it('builds the selected provider with the D-4 model or its override', () => {
    expect(getProvider(parseEnv({ USE_GEMINI: 'true', GEMINI_API_KEY: 'placeholder' }))).toMatchObject({ name: 'gemini', model: 'gemini-3.8-flash' });
    expect(getProvider(parseEnv({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'placeholder', OPENAI_MODEL: 'gpt-x' }))).toMatchObject({ name: 'openai', model: 'gpt-x' });
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'placeholder' });
    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'placeholder', maxRetries: 0 });
  });
});

describe('shared helpers', () => {
  it('emits a strict JSON schema without the $schema marker', () => {
    expect(toJsonSchema(schema)).toEqual({
      type: 'object',
      properties: { nudge: { type: 'string' }, slots: { type: 'array', items: { type: 'string' } } },
      required: ['nudge', 'slots'],
      additionalProperties: false,
    });
  });

  it('maps output problems to reason codes', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as LlmError).reason;
      }
      return 'ok';
    };
    expect(code(() => parseJsonOutput(undefined, schema))).toBe('llm_empty');
    expect(code(() => parseJsonOutput('{"nudge":', schema))).toBe('llm_invalid_json');
    expect(code(() => parseJsonOutput('{"nudge":"x"}', schema))).toBe('llm_schema_mismatch');
    expect(parseJsonOutput(JSON.stringify(valid), schema)).toEqual(valid);
  });

  it('aborts at the deadline and reports llm_timeout; other failures become llm_request_failed', async () => {
    let aborted = false;
    const slow = withTimeout(20, (signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { aborted = true; });
      setTimeout(resolve, 500);
    }));
    expect(await reason(slow)).toBe('llm_timeout');
    expect(aborted).toBe(true);
    expect(await reason(withTimeout(1000, () => Promise.reject(new Error('socket hang up with key=abc'))))).toBe('llm_request_failed');
  });
});

describe('Gemini adapter (@google/genai)', () => {
  it('requests schema-constrained JSON with the system instruction and an abort signal', async () => {
    mockGenerate.mockResolvedValue({ text: JSON.stringify(valid), candidates: [{ finishReason: 'STOP' }] });
    await expect(createGeminiProvider('placeholder', 'gemini-3.8-flash').generateJson(request)).resolves.toEqual(valid);
    const [call] = mockGenerate.mock.calls[0];
    expect(call).toMatchObject({
      model: 'gemini-3.8-flash',
      contents: 'facts',
      config: { systemInstruction: 'sys', responseMimeType: 'application/json', responseJsonSchema: request.jsonSchema },
    });
    expect(call.config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('treats a non-STOP finish as incomplete and bad JSON as invalid', async () => {
    const gemini = createGeminiProvider('placeholder', 'gemini-3.8-flash');
    mockGenerate.mockResolvedValueOnce({ text: '{"nudge":"Cons', candidates: [{ finishReason: 'MAX_TOKENS' }] });
    expect(await reason(gemini.generateJson(request))).toBe('llm_incomplete');
    mockGenerate.mockResolvedValueOnce({ text: 'not json', candidates: [{ finishReason: 'STOP' }] });
    expect(await reason(gemini.generateJson(request))).toBe('llm_invalid_json');
  });
});

describe('OpenAI adapter (Responses API)', () => {
  it('uses Structured Outputs with a strict JSON schema, the timeout, and an abort signal', async () => {
    mockCreate.mockResolvedValue({ status: 'completed', output_text: JSON.stringify(valid) });
    await expect(createOpenAiProvider('placeholder', 'gpt-5.6-terra').generateJson(request)).resolves.toEqual(valid);
    const [body, options] = mockCreate.mock.calls[0];
    expect(body).toEqual({
      model: 'gpt-5.6-terra',
      instructions: 'sys',
      input: 'facts',
      text: { format: { type: 'json_schema', name: 'response', schema: request.jsonSchema, strict: true } },
    });
    expect(options.timeout).toBe(1000);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('treats an incomplete response as a failure', async () => {
    mockCreate.mockResolvedValue({ status: 'incomplete', output_text: '{"nudge":"x"' });
    expect(await reason(createOpenAiProvider('placeholder', 'gpt-5.6-terra').generateJson(request))).toBe('llm_incomplete');
  });
});
