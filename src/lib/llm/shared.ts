import 'server-only';
import { z } from 'zod/v4';

export interface GenerateJsonRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  timeoutMs: number;
}

export interface LlmProvider {
  readonly name: 'gemini' | 'openai';
  readonly model: string;
  generateJson<T>(request: GenerateJsonRequest<T>): Promise<T>;
}

export type LlmFailure =
  | 'llm_timeout'
  | 'llm_request_failed'
  | 'llm_incomplete'
  | 'llm_empty'
  | 'llm_invalid_json'
  | 'llm_schema_mismatch';

/** A provider failure reduced to a reason code, so callers never log or return SDK error details. */
export class LlmError extends Error {
  constructor(readonly reason: LlmFailure) {
    super(reason);
    this.name = 'LlmError';
  }
}

/** JSON Schema for structured output. The `$schema` marker is dropped because providers take the bare schema. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(schema) };
  delete jsonSchema.$schema;
  return jsonSchema;
}

export function parseJsonOutput<T>(text: string | undefined, schema: z.ZodType<T>): T {
  if (!text) throw new LlmError('llm_empty');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LlmError('llm_invalid_json');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new LlmError('llm_schema_mismatch');
  return parsed.data;
}

/** Runs `call` with an abort signal and a hard deadline; any other failure becomes `llm_request_failed`. */
export async function withTimeout<T>(timeoutMs: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LlmError('llm_timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([call(controller.signal), deadline]);
  } catch (error) {
    if (error instanceof LlmError) throw error;
    throw new LlmError('llm_request_failed');
  } finally {
    clearTimeout(timer);
  }
}
