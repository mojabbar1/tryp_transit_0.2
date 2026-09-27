/**
 * Health API Route
 *
 * Reports whether the LLM and traffic integrations are configured. Configuration is reported as
 * booleans only — never values, lengths, or prefixes. The web app calls no prediction service (F-07),
 * so there is nothing else to probe.
 */

import { NextResponse } from 'next/server';
import { parseEnv } from '@/lib/env';
import type { HealthResponse } from '@/types/interfaces';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Parsed per request (not the cached getEnv) so the probe always reflects the live configuration.
  const env = parseEnv(process.env);

  return NextResponse.json<HealthResponse>({
    status: 'ok',
    configured: {
      llm: env.llmProvider !== 'none',
      traffic: Boolean(env.tomtomApiKey),
    },
  });
}
