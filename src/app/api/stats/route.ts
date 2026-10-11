/**
 * GET /api/stats — headline stats from approved facts, with citations (P4b). Proxies the data agent's /v1/stats,
 * revalidated hourly; with the agent off or down it reports `available: false` (the page shows "data unavailable").
 */

import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { log } from '@/lib/log';
import { loadStats } from '@/lib/stats/load';
import type { ApiErrorResponse } from '@/types/interfaces';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = await loadStats(getEnv());
    const cacheControl = stats.available ? 'public, max-age=300, s-maxage=3600, stale-while-revalidate=600' : 'public, max-age=60';
    return NextResponse.json(stats, { headers: { 'cache-control': cacheControl } });
  } catch (error) {
    log.error('stats_failed', { error: error instanceof Error ? error.name : typeof error });
    return NextResponse.json<ApiErrorResponse>({ error: 'Internal Server Error.' }, { status: 500 });
  }
}
