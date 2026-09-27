import 'server-only';
import { FinishReason, GoogleGenAI } from '@google/genai';
import { type GenerateJsonRequest, type LlmProvider, LlmError, parseJsonOutput, withTimeout } from './shared';

/** Gemini via the @google/genai SDK, with JSON output constrained by a JSON Schema. */
export function createGeminiProvider(apiKey: string, model: string): LlmProvider {
  const ai = new GoogleGenAI({ apiKey });
  return {
    name: 'gemini',
    model,
    generateJson<T>(request: GenerateJsonRequest<T>) {
      return withTimeout(request.timeoutMs, async (signal) => {
        const response = await ai.models.generateContent({
          model,
          contents: request.user,
          config: {
            systemInstruction: request.system,
            responseMimeType: 'application/json',
            responseJsonSchema: request.jsonSchema,
            abortSignal: signal,
          },
        });
        const finish = response.candidates?.[0]?.finishReason;
        if (finish !== undefined && finish !== FinishReason.STOP) throw new LlmError('llm_incomplete');
        return parseJsonOutput(response.text, request.schema);
      });
    },
  };
}
