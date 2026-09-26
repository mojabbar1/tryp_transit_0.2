/**
 * Health API Route
 *
 * Reports whether the ridership service is reachable and whether the LLM and traffic
 * integrations are configured. Configuration is reported as booleans only — never values,
 * lengths, or prefixes.
 */

import { NextResponse } from 'next/server';
import { checkRidershipServiceHealth } from '@/lib/api/ridership';
import { isTomTomConfigured } from '@/lib/api/tomtom';
import type { HealthResponse } from '@/types/interfaces';

export const dynamic = 'force-dynamic';

// Mirrors the provider selection in /api/transit-insights (USE_GEMINI toggles Gemini vs OpenAI)
function isLlmConfigured(): boolean {
  const useGemini = process.env.USE_GEMINI === 'true';
  return Boolean(useGemini ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);
}

export async function GET() {
  const ridershipUp = await checkRidershipServiceHealth();

  return NextResponse.json<HealthResponse>({
    status: 'ok',
    checks: {
      ridershipService: ridershipUp ? 'up' : 'down',
    },
    configured: {
      llm: isLlmConfigured(),
      traffic: isTomTomConfigured(),
    },
  });
}
