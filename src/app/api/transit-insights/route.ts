/**
 * POST /api/transit-insights: a thin wrapper around the single v2 engine (src/lib/insights/v2.ts).
 * Numbers are computed deterministically; the LLM only narrates by reference, with a template fallback.
 */

import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import { buildTransitInsights } from '@/lib/insights/v2';
import { log } from '@/lib/log';
import type { ApiErrorResponse } from '@/types/interfaces';

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json<ApiErrorResponse>({ error: 'Invalid request', details: 'body must be JSON' }, { status: 400 });
  }

  try {
    const result = await buildTransitInsights(input, { requestId });
    // The answer is personalized (a rider's points and stops) and time-sensitive (the next bus): never cache it.
    return NextResponse.json(result.body, { status: result.status, headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    // Axios errors carry request URLs with keys, so only their name is logged.
    const message = error instanceof Error && !axios.isAxiosError(error) ? error.message : undefined;
    log.error('transit_insights_failed', { requestId, error: error instanceof Error ? error.name : typeof error, message });
    return NextResponse.json<ApiErrorResponse>({ error: 'Internal Server Error.' }, { status: 500 });
  }
}
