/**
 * TomTom API client utilities
 * Shared across API routes for traffic data
 */

import axios from 'axios';

const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;

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
  if (!TOMTOM_API_KEY) {
    throw new Error('NEXT_PUBLIC_TOMTOM_API_KEY environment variable is not set');
  }

  const response = await axios.get<TrafficFlowData>(
    'https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json',
    {
      params: {
        key: TOMTOM_API_KEY,
        point: `${point.lat},${point.lng}`,
      },
    }
  );

  return response.data;
}

/**
 * Calculate bounding box from two points
 */
export function calculateBbox(departure: Coordinates, destination: Coordinates): string {
  return `${Math.min(departure.lat, destination.lat)},${Math.min(
    departure.lng,
    destination.lng
  )},${Math.max(departure.lat, destination.lat)},${Math.max(
    departure.lng,
    destination.lng
  )}`;
}

/**
 * Get traffic incidents within a bounding box
 */
export async function getIncidents(bbox: string): Promise<unknown> {
  if (!TOMTOM_API_KEY) {
    throw new Error('NEXT_PUBLIC_TOMTOM_API_KEY environment variable is not set');
  }

  const response = await axios.get(
    'https://api.tomtom.com/traffic/services/5/incidentDetails',
    {
      params: {
        key: TOMTOM_API_KEY,
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
