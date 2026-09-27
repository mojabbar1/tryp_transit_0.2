/**
 * Health API Route
 *
 * Reports whether the ridership service is reachable and whether the LLM and traffic
 * integrations are configured. Configuration is reported as booleans only — never values,
 * lengths, or prefixes.
 */

import { NextResponse } from 'next/server';
import { checkRidershipServiceHealth } from '@/lib/api/ridership';
import { parseEnv } from '@/lib/env';
import type { HealthResponse } from '@/types/interfaces';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ridershipUp = await checkRidershipServiceHealth();
  // Parsed per request (not the cached getEnv) so the probe always reflects the live configuration.
  const env = parseEnv(process.env);

  return NextResponse.json<HealthResponse>({
    status: 'ok',
    checks: {
      ridershipService: ridershipUp ? 'up' : 'down',
    },
    configured: {
      llm: env.llmProvider !== 'none',
      traffic: Boolean(env.tomtomApiKey),
    },
  });
}
