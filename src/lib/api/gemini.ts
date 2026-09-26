/**
 * Gemini API client utilities
 * Shared across API routes for consistent AI interaction
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

let genAIInstance: GoogleGenerativeAI | null = null;
let modelInstance: GenerativeModel | null = null;

/** Default Gemini model (D-4; GA per ai.google.dev, re-checked 2026-09-25). Override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

/**
 * The Gemini model ID: GEMINI_MODEL from env, or the default when it is unset or blank
 * (the blank `GEMINI_MODEL=` line in .env.example must not select an empty model ID).
 */
export function getGeminiModelId(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

/**
 * Get or create the Gemini AI instance
 */
export function getGeminiClient(): GoogleGenerativeAI {
  if (!genAIInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    genAIInstance = new GoogleGenerativeAI(apiKey);
  }
  return genAIInstance;
}

/**
 * Get or create the Gemini model for JSON responses
 */
export function getGeminiModel(): GenerativeModel {
  if (!modelInstance) {
    const client = getGeminiClient();
    // No generationConfig: Gemini 3.x deprecates temperature/topP/topK, and maxOutputTokens counts
    // thinking tokens, so a small cap can truncate the JSON (ai.google.dev latest-model, thinking docs).
    modelInstance = client.getGenerativeModel({
      model: getGeminiModelId(),
    });
  }
  return modelInstance;
}

/**
 * Call Gemini API with a prompt and get the raw text response
 */
export async function callGemini(prompt: string): Promise<string> {
  const model = getGeminiModel();
  
  // Add explicit JSON instructions
  const enhancedPrompt = `${prompt}\n\nIMPORTANT: Return ONLY valid JSON without any markdown formatting, explanations, or code blocks. The response should be parseable directly with JSON.parse().`;
  
  const response = await model.generateContent(enhancedPrompt);
  return response.response.text();
}

/**
 * Extract JSON from a response that may contain markdown code blocks
 */
export function extractJsonFromMarkdown(text: string): string | null {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    return jsonMatch[1].trim();
  }
  return null;
}

/**
 * Parse a JSON response, handling both raw JSON and markdown-wrapped JSON
 */
export function parseJsonResponse<T>(text: string): T {
  // First, try direct parsing
  try {
    return JSON.parse(text) as T;
  } catch {
    // Try extracting from markdown code block
    const extracted = extractJsonFromMarkdown(text);
    if (extracted) {
      return JSON.parse(extracted) as T;
    }
    throw new Error(`Could not parse JSON from response: ${text.substring(0, 200)}`);
  }
}
