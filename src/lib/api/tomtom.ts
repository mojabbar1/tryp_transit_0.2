/**
 * TomTom client (server-side). Callers pass the API key explicitly; nothing here reads the environment.
 * Request URLs carry the key, so callers log reason codes and never the thrown error or its config.
 */

import axios from 'axios';

const BASE_URL = 'https://api.tomtom.com';
const TIMEOUT_MS = 5000;
const METERS_PER_MILE = 1609.344;
// Incident search box limits (engineering guards, not trip facts): a span under ~100 m is degenerate and is
// widened to ~1 km; a span over half a degree is clamped around its centre.
const DEGENERATE_SPAN_DEG = 0.001;
const MIN_BBOX_SPAN_DEG = 0.01;
const MAX_BBOX_SPAN_DEG = 0.5;

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface FlowSegment {
  currentSpeed: number;
  freeFlowSpeed: number;
  currentTravelTime: number;
  freeFlowTravelTime: number;
  confidence: number;
  roadClosure?: boolean;
}

export interface TrafficFlowData {
  flowSegmentData: FlowSegment;
}

export interface TrafficIncident {
  type: 'Feature';
  geometry: { type: 'Point' | 'LineString'; coordinates: number[] | number[][] };
  properties: { iconCategory: number };
}

export interface IncidentDetailsResponse {
  incidents: TrafficIncident[];
}

interface RouteSummary {
  lengthInMeters: number;
  travelTimeInSeconds: number;
  trafficDelayInSeconds: number;
  noTrafficTravelTimeInSeconds?: number;
  departureTime: string;
  arrivalTime: string;
}

interface CalculateRouteResponse {
  routes: { summary: RouteSummary }[];
}

export interface DriveRoute {
  minutes: number;
  delayMinutes: number;
  distanceMiles: number;
  freeFlowMinutes?: number;
}

export interface DriveRouteResult {
  route: DriveRoute;
  degraded: string[];
}

export interface TrafficData {
  /** [departure, destination]; null where that lookup failed. */
  flows: [FlowSegment | null, FlowSegment | null];
  incidents: TrafficIncident[] | null;
  degraded: string[];
}

export async function getTrafficFlow(apiKey: string, point: Coordinates): Promise<FlowSegment> {
  const response = await axios.get<TrafficFlowData>(`${BASE_URL}/traffic/services/4/flowSegmentData/absolute/10/json`, {
    params: { key: apiKey, point: `${point.lat},${point.lng}` },
    timeout: TIMEOUT_MS,
  });
  return response.data.flowSegmentData;
}

/**
 * Bounding box for TomTom Incident Details from two points.
 * TomTom expects longitude first: minLon,minLat,maxLon,maxLat (lower-left, then upper-right).
 */
export function calculateBbox(departure: Coordinates, destination: Coordinates): string {
  const minLon = Math.min(departure.lng, destination.lng);
  const minLat = Math.min(departure.lat, destination.lat);
  const maxLon = Math.max(departure.lng, destination.lng);
  const maxLat = Math.max(departure.lat, destination.lat);
  return `${minLon},${minLat},${maxLon},${maxLat}`;
}

/** calculateBbox plus an area guard, so TomTom never receives a zero-area or oversized box. */
export function incidentBbox(departure: Coordinates, destination: Coordinates): { bbox: string; degraded: string[] } {
  const degraded = new Set<string>();
  const axis = (a: number, b: number, lower: number, upper: number): [number, number] => {
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    const mid = (lo + hi) / 2;
    if (hi - lo < DEGENERATE_SPAN_DEG) {
      [lo, hi] = [mid - MIN_BBOX_SPAN_DEG / 2, mid + MIN_BBOX_SPAN_DEG / 2];
      degraded.add('incidents_area_widened');
    } else if (hi - lo > MAX_BBOX_SPAN_DEG) {
      [lo, hi] = [mid - MAX_BBOX_SPAN_DEG / 2, mid + MAX_BBOX_SPAN_DEG / 2];
      degraded.add('incidents_area_clamped');
    }
    return [Number(Math.max(lower, lo).toFixed(6)), Number(Math.min(upper, hi).toFixed(6))];
  };
  const [minLon, maxLon] = axis(departure.lng, destination.lng, -180, 180);
  const [minLat, maxLat] = axis(departure.lat, destination.lat, -90, 90);
  return { bbox: `${minLon},${minLat},${maxLon},${maxLat}`, degraded: [...degraded] };
}

export async function getIncidents(apiKey: string, bbox: string): Promise<IncidentDetailsResponse> {
  const response = await axios.get<IncidentDetailsResponse>(`${BASE_URL}/traffic/services/5/incidentDetails`, {
    params: {
      key: apiKey,
      bbox,
      fields: '{incidents{type,geometry{type,coordinates},properties{iconCategory}}}',
      language: 'en-GB',
      timeValidityFilter: 'present',
    },
    timeout: TIMEOUT_MS,
  });
  return response.data;
}

/** Local wall time with its UTC offset, e.g. 2026-09-28T08:30:00-04:00 (TomTom's documented dateTime form). */
export function toTomTomDateTime(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function toDriveRoute(data: CalculateRouteResponse): { route: DriveRoute; departureTime: number } {
  const summary = data.routes?.[0]?.summary;
  const seconds = [summary?.lengthInMeters, summary?.travelTimeInSeconds, summary?.trafficDelayInSeconds];
  if (!summary || !seconds.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
    throw new Error('route_invalid');
  }
  const freeFlow = summary.noTrafficTravelTimeInSeconds;
  return {
    route: {
      minutes: Math.round(summary.travelTimeInSeconds / 60),
      delayMinutes: Math.round(summary.trafficDelayInSeconds / 60),
      distanceMiles: summary.lengthInMeters / METERS_PER_MILE,
      ...(typeof freeFlow === 'number' && Number.isFinite(freeFlow) && freeFlow >= 0
        ? { freeFlowMinutes: Math.round(freeFlow / 60) }
        : {}),
    },
    departureTime: Date.parse(summary.departureTime),
  };
}

/**
 * Drive route for the desired arrival time, via TomTom's `arriveAt` (never `departAt`; they can't be combined).
 * When TomTom can't meet the arrival (a departure before now, or a 400 for the time), it plans a
 * `departAt=now` route instead and reports `arrival_target_too_soon`.
 */
export async function getDriveRoute(
  apiKey: string,
  departure: Coordinates,
  destination: Coordinates,
  arriveAt: Date,
  now: Date,
  timeZone: string,
): Promise<DriveRouteResult> {
  const url = `${BASE_URL}/routing/1/calculateRoute/${departure.lat},${departure.lng}:${destination.lat},${destination.lng}/json`;
  const plan = async (time: { arriveAt: string } | { departAt: 'now' }) => {
    const response = await axios.get<CalculateRouteResponse>(url, {
      params: { key: apiKey, traffic: true, computeTravelTimeFor: 'all', ...time },
      timeout: TIMEOUT_MS,
    });
    return toDriveRoute(response.data);
  };

  if (arriveAt.getTime() > now.getTime()) {
    try {
      const planned = await plan({ arriveAt: toTomTomDateTime(arriveAt, timeZone) });
      if (Number.isFinite(planned.departureTime) && planned.departureTime >= now.getTime()) {
        return { route: planned.route, degraded: [] };
      }
    } catch (error) {
      if (!(axios.isAxiosError(error) && error.response?.status === 400)) throw error;
    }
  }
  const fallback = await plan({ departAt: 'now' });
  return { route: fallback.route, degraded: ['arrival_target_too_soon'] };
}

/** Current flow at both ends plus incidents, settled independently: partial data with reason codes, never a throw. */
export async function getTrafficData(apiKey: string, departure: Coordinates, destination: Coordinates): Promise<TrafficData> {
  const { bbox, degraded } = incidentBbox(departure, destination);
  const [origin, target, incidents] = await Promise.allSettled([
    getTrafficFlow(apiKey, departure),
    getTrafficFlow(apiKey, destination),
    getIncidents(apiKey, bbox),
  ]);
  if (origin.status === 'rejected' || target.status === 'rejected') degraded.push('traffic_flow_unavailable');
  const incidentList =
    incidents.status === 'fulfilled' && Array.isArray(incidents.value?.incidents) ? incidents.value.incidents : null;
  if (incidentList === null) degraded.push('incidents_unavailable');
  return {
    flows: [origin.status === 'fulfilled' ? origin.value : null, target.status === 'fulfilled' ? target.value : null],
    incidents: incidentList,
    degraded,
  };
}
