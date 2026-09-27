/**
 * Transit Insights Demo API Route (demo mode only)
 *
 * Returns deterministic demo scenarios for walkthroughs without API keys. It answers only while
 * NEXT_PUBLIC_DEMO_MODE=true; otherwise it returns 404, so no invented numbers reach live mode.
 *
 * Usage:
 *   POST /api/transit-insights-demo
 *   Body: { "demoScenario": "rush-hour" | "weekend" | "night-out" }   (anything else falls back to "rush-hour")
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDemoMode } from '@/lib/demo-mode';
import { demoResponse, isDemoScenario } from '@/lib/demo/scenarios';
import type { ApiErrorResponse, TransitInsightResponse } from '@/types/interfaces';

export async function POST(req: NextRequest) {
  if (!isDemoMode()) {
    return NextResponse.json<ApiErrorResponse>({ error: 'Demo mode is off' }, { status: 404 });
  }
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const requested = typeof body === 'object' && body !== null ? (body as { demoScenario?: unknown }).demoScenario : undefined;

    // Artificial delay to showcase the loading experience
    await new Promise((resolve) => setTimeout(resolve, 3000));

    return NextResponse.json<TransitInsightResponse>(demoResponse(isDemoScenario(requested) ? requested : 'rush-hour', new Date()));
  } catch (error) {
    console.error('Demo API error:', error instanceof Error ? error.name : typeof error);
    return NextResponse.json<ApiErrorResponse>({ error: 'Demo service temporarily unavailable' }, { status: 500 });
  }
}
