import 'server-only';
import { z } from 'zod';

/**
 * Server-only runtime configuration (P1 T2), parsed and validated on first use.
 *
 * `server-only` makes the build fail if a client module imports this file. Validation errors name the
 * offending variables and never echo their values. There is no engine switch (D-27) and no ridership
 * service URL: the live request path never calls the ridership service. `NEXT_PUBLIC_DEMO_MODE` is a
 * separate, client-readable flag and is deliberately not read here.
 */

// D-4 defaults. They equal the P0 clients' constants in lib/api (asserted in the env tests); P1c
// replaces those clients with the LLM seam, which reads models from here.
const D4_GEMINI_MODEL = 'gemini-3.8-flash';
const D4_OPENAI_MODEL = 'gpt-5.6-terra';
const DEFAULT_LLM_TIMEOUT_MS = 8000;
const DEFAULT_REGION_TIMEZONE = 'America/New_York';

export type LlmProviderName = 'gemini' | 'openai' | 'none';

export interface ServerEnv {
  /** The provider the app will call: `none` when none is selected or the selected one has no key. */
  readonly llmProvider: LlmProviderName;
  readonly geminiApiKey?: string;
  readonly openaiApiKey?: string;
  readonly geminiModel: string;
  readonly openaiModel: string;
  readonly llmTimeoutMs: number;
  readonly tomtomApiKey?: string;
  readonly regionTimezone: string;
  /** Unused until P4. */
  readonly dataAgentBaseUrl?: string;
}

/** Trims strings and treats a blank value as unset, so `KEY=` in an env file means "use the default". */
const clean = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(clean, schema.optional());

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const isHttpUrl = (value: string) => {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
};

const RawEnvSchema = z.object({
  LLM_PROVIDER: optional(z.enum(['gemini', 'openai', 'none'])),
  USE_GEMINI: optional(z.string()),
  GEMINI_API_KEY: optional(z.string()),
  OPENAI_API_KEY: optional(z.string()),
  GEMINI_MODEL: optional(z.string()),
  OPENAI_MODEL: optional(z.string()),
  LLM_TIMEOUT_MS: optional(z.coerce.number().int().min(1).max(60_000)),
  TOMTOM_API_KEY: optional(z.string()),
  NEXT_PUBLIC_TOMTOM_API_KEY: optional(z.string()),
  REGION_TIMEZONE: optional(z.string().refine(isTimeZone)),
  DATA_AGENT_BASE_URL: optional(z.string().refine(isHttpUrl)),
});

/** Secrets are non-enumerable, so `JSON.stringify` and `console.log` of the env object never print them. */
function defineSecret(target: object, key: string, value: string | undefined) {
  Object.defineProperty(target, key, { value, enumerable: false });
}

let warnedLegacyTomTomName = false;

export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = RawEnvSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new Error(`Invalid server environment: ${names.join(', ')}`);
  }
  const raw = result.data;

  // Unset LLM_PROVIDER keeps the P0 route's rule: USE_GEMINI === 'true' selects Gemini, anything else OpenAI.
  const selected = raw.LLM_PROVIDER ?? (raw.USE_GEMINI === 'true' ? 'gemini' : 'openai');
  const selectedKey =
    selected === 'gemini' ? raw.GEMINI_API_KEY : selected === 'openai' ? raw.OPENAI_API_KEY : undefined;
  const llmProvider: LlmProviderName = selectedKey ? selected : 'none';

  const env = {
    llmProvider,
    geminiModel: raw.GEMINI_MODEL ?? D4_GEMINI_MODEL,
    openaiModel: raw.OPENAI_MODEL ?? D4_OPENAI_MODEL,
    llmTimeoutMs: raw.LLM_TIMEOUT_MS ?? DEFAULT_LLM_TIMEOUT_MS,
    regionTimezone: raw.REGION_TIMEZONE ?? DEFAULT_REGION_TIMEZONE,
    dataAgentBaseUrl: raw.DATA_AGENT_BASE_URL,
  };
  defineSecret(env, 'geminiApiKey', raw.GEMINI_API_KEY);
  defineSecret(env, 'openaiApiKey', raw.OPENAI_API_KEY);
  if (!raw.TOMTOM_API_KEY && raw.NEXT_PUBLIC_TOMTOM_API_KEY && !warnedLegacyTomTomName) {
    warnedLegacyTomTomName = true;
    console.warn('NEXT_PUBLIC_TOMTOM_API_KEY is deprecated; rename it to TOMTOM_API_KEY (server-only).');
  }
  defineSecret(env, 'tomtomApiKey', raw.TOMTOM_API_KEY ?? raw.NEXT_PUBLIC_TOMTOM_API_KEY);
  return Object.freeze(env) as ServerEnv;
}

let cached: ServerEnv | undefined;

/** Lazy: nothing is read at import time, so builds and tests don't need the variables. */
export function getEnv(): ServerEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
