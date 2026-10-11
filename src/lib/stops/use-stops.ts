'use client';

import { useEffect, useState } from 'react';
import { type StopsResponse, StopsResponseSchema } from './types';

export type StopsState =
  | { status: 'loading'; data: null }
  | { status: 'ready'; data: StopsResponse }
  | { status: 'error'; data: null };

/** Loads the picker's stop list once from GET /api/stops; a malformed reply is an error, not a list. */
export function useStops(): StopsState {
  const [state, setState] = useState<StopsState>({ status: 'loading', data: null });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/stops', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = StopsResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error('malformed stops');
        setState({ status: 'ready', data: parsed.data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Stops request failed:', error instanceof Error ? error.message : 'unknown');
          setState({ status: 'error', data: null });
        }
      });
    return () => controller.abort();
  }, []);
  return state;
}

/** One line telling the rider what the list is, so places are never mistaken for CARTA stops. */
export function stopSourceNote(data: StopsResponse | null): string | null {
  if (!data) return null;
  if (data.source === 'legacy_places') {
    return 'CARTA stop data is unavailable right now. These are approximate locations, not bus stops, so bus schedules can’t be shown.';
  }
  if (data.source === 'gtfs_fallback') return 'Showing the saved CARTA stop list; live schedule data is unavailable right now.';
  return null;
}
