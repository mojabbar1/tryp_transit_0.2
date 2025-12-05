/**
 * Gemini API client utilities
 * Shared across API routes for consistent AI interaction
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

let genAIInstance: GoogleGenerativeAI | null = null;
let modelInstance: GenerativeModel | null = null;

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
 * Get or create the Gemini model with optimized settings for JSON responses
 */
export function getGeminiModel(): GenerativeModel {
  if (!modelInstance) {
    const client = getGeminiClient();
    modelInstance = client.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 2048,
      },
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
