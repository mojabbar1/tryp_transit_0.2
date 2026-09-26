/**
 * TomTom API client utilities
 * Shared across API routes for traffic data
 */

import axios from 'axios';

let warnedLegacyKeyName = false;

/**
 * Resolve the TomTom API key. Prefers the server-only TOMTOM_API_KEY; the legacy
 * NEXT_PUBLIC_TOMTOM_API_KEY is still read as a fallback, with a one-time warning.
 */
export function getTomTomApiKey(): string | undefined {
  const apiKey = process.env.TOMTOM_API_KEY ?? process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
  if (process.env.TOMTOM_API_KEY === undefined && apiKey !== undefined && !warnedLegacyKeyName) {
    warnedLegacyKeyName = true;
    console.warn(
      'NEXT_PUBLIC_TOMTOM_API_KEY is deprecated; rename it to TOMTOM_API_KEY (server-only).'
    );
  }
  return apiKey;
}

/**
 * Whether a TomTom API key is configured (under either name). Never exposes the value.
 */
export function isTomTomConfigured(): boolean {
  return Boolean(process.env.TOMTOM_API_KEY ?? process.env.NEXT_PUBLIC_TOMTOM_API_KEY);
}

export interface TrafficFlowData {
  flowSegmentData: {
    currentSpeed: number;
    freeFlowSpeed: number;
    currentTravelTime: number;
    freeFlowTravelTime: number;
    confidence: number;
  };
}

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Get traffic flow data for a specific location
 */
export async function getTrafficFlow(point: Coordinates): Promise<TrafficFlowData> {
  const apiKey = getTomTomApiKey();
  if (!apiKey) {
    throw new Error('TOMTOM_API_KEY environment variable is not set');
  }

  const response = await axios.get<TrafficFlowData>(
    'https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json',
    {
      params: {
        key: apiKey,
        point: `${point.lat},${point.lng}`,
      },
    }
  );

  return response.data;
}

/**
 * Calculate the bounding box for TomTom Incident Details from two points.
 * TomTom expects longitude first: minLon,minLat,maxLon,maxLat (lower-left, then upper-right).
 */
export function calculateBbox(departure: Coordinates, destination: Coordinates): string {
  const minLon = Math.min(departure.lng, destination.lng);
  const minLat = Math.min(departure.lat, destination.lat);
  const maxLon = Math.max(departure.lng, destination.lng);
  const maxLat = Math.max(departure.lat, destination.lat);
  return `${minLon},${minLat},${maxLon},${maxLat}`;
}

/**
 * Get traffic incidents within a bounding box
 */
export async function getIncidents(bbox: string): Promise<unknown> {
  const apiKey = getTomTomApiKey();
  if (!apiKey) {
    throw new Error('TOMTOM_API_KEY environment variable is not set');
  }

  const response = await axios.get(
    'https://api.tomtom.com/traffic/services/5/incidentDetails',
    {
      params: {
        key: apiKey,
        bbox,
        fields: '{incidents{type,geometry{type,coordinates},properties{iconCategory}}}',
        language: 'en-GB',
        timeValidityFilter: 'present',
      },
    }
  );

  return response.data;
}

/**
 * Get all traffic data (flow + incidents) for a route
 */
export async function getTrafficData(
  departure: Coordinates,
  destination: Coordinates
): Promise<{
  flow: { current: TrafficFlowData; destination: TrafficFlowData };
  incidents: unknown;
}> {
  const bbox = calculateBbox(departure, destination);

  const [flowCurrent, flowDestination, incidents] = await Promise.all([
    getTrafficFlow(departure),
    getTrafficFlow(destination),
    getIncidents(bbox),
  ]);

  return {
    flow: {
      current: flowCurrent,
      destination: flowDestination,
    },
    incidents,
  };
}
