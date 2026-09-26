/**
 * Unit tests for OpenAI API utilities
 */

import { DEFAULT_OPENAI_MODEL, getOpenAIModelId } from '@/lib/api/openai';

describe('getOpenAIModelId', () => {
  const saved = process.env.OPENAI_MODEL;

  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = saved;
  });

  it('defaults to gpt-5.6-terra (D-4)', () => {
    delete process.env.OPENAI_MODEL;

    expect(DEFAULT_OPENAI_MODEL).toBe('gpt-5.6-terra');
    expect(getOpenAIModelId()).toBe('gpt-5.6-terra');
  });

  it('uses OPENAI_MODEL when set', () => {
    process.env.OPENAI_MODEL = 'gpt-override';

    expect(getOpenAIModelId()).toBe('gpt-override');
  });

  it('falls back to the default when OPENAI_MODEL is blank', () => {
    process.env.OPENAI_MODEL = '';
    expect(getOpenAIModelId()).toBe(DEFAULT_OPENAI_MODEL);

    process.env.OPENAI_MODEL = '   ';
    expect(getOpenAIModelId()).toBe(DEFAULT_OPENAI_MODEL);
  });
});
