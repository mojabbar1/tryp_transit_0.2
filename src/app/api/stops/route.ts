/**
 * GET /api/stops?query=&limit= — the stop picker's list (P4b; contract: src/lib/stops/types.ts).
 *
 * Proxies the data agent's active-feed stops (shared for a day); with the agent off or down it serves the committed
 * export-stops fallback, or, while no real export exists, the P1 approximate places labeled as such (the rollback
 * path). A search filters the shared list on the server, so the rider's text never goes upstream, and its response
 * is private and uncached.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { log } from '@/lib/log';
import { getStopCatalog } from '@/lib/stops/catalog';
import { filterStops } from '@/lib/stops/types';
import type { ApiErrorResponse } from '@/types/interfaces';

export const dynamic = 'force-dynamic';

const DEFAULT_SEARCH_LIMIT = 50;
const MAX_LIMIT = 2000;
const MAX_QUERY_CHARS = 100;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('query') ?? '';
  const rawLimit = request.nextUrl.searchParams.get('limit');
  const limit = rawLimit === null ? null : Number(rawLimit);
  if (query.length > MAX_QUERY_CHARS || (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT))) {
    return NextResponse.json<ApiErrorResponse>({ error: 'Invalid request', details: 'query, limit' }, { status: 400 });
  }

  try {
    const catalog = await getStopCatalog(getEnv());
    const searching = query.trim() !== '';
    const stops = filterStops(catalog.stops, query, limit ?? (searching ? DEFAULT_SEARCH_LIMIT : MAX_LIMIT));
    // A full list from the agent is shared for a day; a fallback is short-lived so recovery shows quickly; a search
    // carries the rider's text, so it is never stored.
    const cacheControl = searching
      ? 'private, no-store'
      : catalog.source === 'data_agent'
        ? 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600'
        : 'public, max-age=60';
    return NextResponse.json({ ...catalog, stops }, { headers: { 'cache-control': cacheControl } });
  } catch (error) {
    log.error('stops_failed', { error: error instanceof Error ? error.name : typeof error });
    return NextResponse.json<ApiErrorResponse>({ error: 'Internal Server Error.' }, { status: 500 });
  }
}
