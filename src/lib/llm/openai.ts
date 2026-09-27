import 'server-only';
import OpenAI from 'openai';
import { type GenerateJsonRequest, type LlmProvider, LlmError, parseJsonOutput, withTimeout } from './shared';

/** OpenAI via the Responses API with Structured Outputs (a strict JSON schema). Retries are off: we fail closed fast. */
export function createOpenAiProvider(apiKey: string, model: string): LlmProvider {
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  return {
    name: 'openai',
    model,
    generateJson<T>(request: GenerateJsonRequest<T>) {
      return withTimeout(request.timeoutMs, async (signal) => {
        const response = await client.responses.create(
          {
            model,
            instructions: request.system,
            input: request.user,
            text: { format: { type: 'json_schema', name: 'response', schema: request.jsonSchema, strict: true } },
          },
          { signal, timeout: request.timeoutMs },
        );
        if (response.status !== 'completed') throw new LlmError('llm_incomplete');
        return parseJsonOutput(response.output_text, request.schema);
      });
    },
  };
}
