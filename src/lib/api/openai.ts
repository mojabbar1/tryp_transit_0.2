/**
 * OpenAI API client utilities
 * Shared across API routes for consistent AI interaction
 */

import OpenAI from 'openai';

let openaiInstance: OpenAI | null = null;

/**
 * Get or create the OpenAI client instance
 */
export function getOpenAIClient(): OpenAI {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openaiInstance = new OpenAI({ apiKey });
  }
  return openaiInstance;
}

/**
 * Call OpenAI API with streaming and collect the full response
 */
export async function callOpenAI(prompt: string, model: string = 'gpt-3.5-turbo'): Promise<string> {
  const client = getOpenAIClient();
  
  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  });

  let result = '';
  for await (const chunk of stream) {
    result += chunk.choices[0]?.delta?.content || '';
  }
  
  return result;
}

/**
 * Call OpenAI API without streaming (simpler for JSON responses)
 */
export async function callOpenAISync(prompt: string, model: string = 'gpt-3.5-turbo'): Promise<string> {
  const client = getOpenAIClient();
  
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0]?.message?.content || '';
}
