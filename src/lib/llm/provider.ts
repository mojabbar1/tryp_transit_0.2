import 'server-only';
import type { ServerEnv } from '@/lib/env';
import { createGeminiProvider } from './gemini';
import { createOpenAiProvider } from './openai';
import type { LlmProvider } from './shared';

export type { GenerateJsonRequest, LlmProvider } from './shared';

/** The configured narration provider, or null (template only) when none is selected or keyed. */
export function getProvider(env: ServerEnv): LlmProvider | null {
  if (env.llmProvider === 'gemini' && env.geminiApiKey) return createGeminiProvider(env.geminiApiKey, env.geminiModel);
  if (env.llmProvider === 'openai' && env.openaiApiKey) return createOpenAiProvider(env.openaiApiKey, env.openaiModel);
  return null;
}
