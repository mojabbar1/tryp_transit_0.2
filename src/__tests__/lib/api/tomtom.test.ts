/**
 * Unit tests for TomTom API utilities
 */

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { __esModule: true, AxiosError: actual.AxiosError, default: { ...actual.default, get: jest.fn(), isAxiosError: actual.default.isAxiosError } };
});

import axios, { AxiosError } from 'axios';
import { calculateBbox, getDriveRoute, getTrafficData, incidentBbox, toTomTomDateTime } from '@/lib/api/tomtom';

describe('TomTom API Utilities', () => {
  describe('calculateBbox', () => {
    it('should calculate correct bounding box for two points', () => {
      const departure = { lat: 32.7913, lng: -79.9353 };
      const destination = { lat: 32.7764, lng: -79.9301 };
      
      const result = calculateBbox(departure, destination);
      
      // Format (TomTom Incident Details): minLon,minLat,maxLon,maxLat
      expect(result).toBe('-79.9353,32.7764,-79.9301,32.7913');
    });

    it('should handle reversed coordinates (destination north of departure)', () => {
      const departure = { lat: 32.7764, lng: -79.9301 };
      const destination = { lat: 32.7913, lng: -79.9353 };
      
      const result = calculateBbox(departure, destination);
      
      // Should still produce same bbox regardless of order
      expect(result).toBe('-79.9353,32.7764,-79.9301,32.7913');
    });

    it('should handle same point (zero-area bbox)', () => {
      const point = { lat: 32.7800, lng: -79.9300 };
      
      const result = calculateBbox(point, point);
      
      expect(result).toBe('-79.93,32.78,-79.93,32.78');
    });

    it('should handle negative latitudes (southern hemisphere)', () => {
      const departure = { lat: -33.8688, lng: 151.2093 }; // Sydney
      const destination = { lat: -33.9173, lng: 151.2313 };
      
      const result = calculateBbox(departure, destination);
      
      expect(result).toBe('151.2093,-33.9173,151.2313,-33.8688');
    });

    it('should handle cross-hemisphere routes', () => {
      const departure = { lat: 1.3521, lng: 103.8198 }; // Singapore
      const destination = { lat: -6.2088, lng: 106.8456 }; // Jakarta
      
      const result = calculateBbox(departure, destination);
      
      expect(result).toBe('103.8198,-6.2088,106.8456,1.3521');
    });
  });
});

const get = axios.get as jest.MockedFunction<typeof axios.get>;
const KEY = 'placeholder-tomtom-value';
const dep = { lat: 32.7813, lng: -79.9306 };
const dest = { lat: 32.7878, lng: -79.9512 };
const now = new Date('2026-09-28T11:00:00Z');
const arriveAt = new Date('2026-09-28T12:30:00Z');

const routeResponse = (departureTime: string) => ({
  data: {
    routes: [
      {
        summary: {
          lengthInMeters: 8047,
          travelTimeInSeconds: 1260,
          trafficDelayInSeconds: 240,
          noTrafficTravelTimeInSeconds: 1020,
          departureTime,
          arrivalTime: '2026-09-28T12:30:00Z',
        },
      },
    ],
  },
});
const httpError = (status: number) =>
  new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, { status } as never);

beforeEach(() => get.mockReset());

describe('incidentBbox', () => {
  it('passes a normal box through unchanged, longitude first', () => {
    expect(incidentBbox(dep, dest)).toEqual({ bbox: '-79.9512,32.7813,-79.9306,32.7878', degraded: [] });
  });

  it('widens a zero-area box around the point and records it', () => {
    expect(incidentBbox(dep, dep)).toEqual({
      bbox: '-79.9356,32.7763,-79.9256,32.7863',
      degraded: ['incidents_area_widened'],
    });
  });

  it('clamps an oversized box around its centre and records it', () => {
    const far = { lat: 33.9, lng: -78.5 };
    const { bbox, degraded } = incidentBbox(dep, far);
    const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
    expect(maxLon - minLon).toBeCloseTo(0.5, 6);
    expect(maxLat - minLat).toBeCloseTo(0.5, 6);
    expect(degraded).toEqual(['incidents_area_clamped']);
  });
});

describe('toTomTomDateTime', () => {
  it('formats local wall time with its offset, across DST', () => {
    expect(toTomTomDateTime(arriveAt, 'America/New_York')).toBe('2026-09-28T08:30:00-04:00');
    expect(toTomTomDateTime(new Date('2026-12-01T13:30:00Z'), 'America/New_York')).toBe('2026-12-01T08:30:00-05:00');
    expect(toTomTomDateTime(arriveAt, 'UTC')).toBe('2026-09-28T12:30:00+00:00');
  });
});

describe('getDriveRoute', () => {
  it('sends the arrival time as arriveAt (never departAt) with a 5 s timeout', async () => {
    get.mockResolvedValueOnce(routeResponse('2026-09-28T12:09:00Z'));
    const result = await getDriveRoute(KEY, dep, dest, arriveAt, now, 'America/New_York');

    expect(get).toHaveBeenCalledTimes(1);
    const [url, config] = get.mock.calls[0];
    expect(url).toBe('https://api.tomtom.com/routing/1/calculateRoute/32.7813,-79.9306:32.7878,-79.9512/json');
    expect(config?.params).toEqual({
      key: KEY,
      traffic: true,
      computeTravelTimeFor: 'all',
      arriveAt: '2026-09-28T08:30:00-04:00',
    });
    expect(config?.params).not.toHaveProperty('departAt');
    expect(config?.timeout).toBe(5000);
    expect(result.degraded).toEqual([]);
    expect(result.route).toEqual({ minutes: 21, delayMinutes: 4, distanceMiles: 8047 / 1609.344, freeFlowMinutes: 17 });
  });

  it('falls back to departAt=now when the planned departure is already past', async () => {
    get.mockResolvedValueOnce(routeResponse('2026-09-28T10:59:00Z')).mockResolvedValueOnce(routeResponse('2026-09-28T11:00:00Z'));
    const result = await getDriveRoute(KEY, dep, dest, arriveAt, now, 'America/New_York');

    const timeParams = get.mock.calls.map(([, config]) => config?.params as { arriveAt?: string; departAt?: string });
    expect(timeParams.map((params) => params.departAt ?? params.arriveAt)).toEqual([
      '2026-09-28T08:30:00-04:00',
      'now',
    ]);
    expect(result.degraded).toEqual(['arrival_target_too_soon']);
  });

  it('falls back when TomTom rejects the arrival time (400)', async () => {
    get.mockRejectedValueOnce(httpError(400)).mockResolvedValueOnce(routeResponse('2026-09-28T11:00:00Z'));
    const result = await getDriveRoute(KEY, dep, dest, arriveAt, now, 'America/New_York');
    expect(result.degraded).toEqual(['arrival_target_too_soon']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not mask an auth failure as a scheduling problem', async () => {
    get.mockRejectedValueOnce(httpError(403));
    await expect(getDriveRoute(KEY, dep, dest, arriveAt, now, 'America/New_York')).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('plans departAt=now directly for an arrival at or before now', async () => {
    get.mockResolvedValueOnce(routeResponse('2026-09-28T11:00:00Z'));
    const result = await getDriveRoute(KEY, dep, dest, now, now, 'America/New_York');
    expect(get.mock.calls[0][1]?.params).toMatchObject({ departAt: 'now' });
    expect(result.degraded).toEqual(['arrival_target_too_soon']);
  });

  it('rejects a malformed route summary', async () => {
    get.mockResolvedValueOnce({ data: { routes: [{ summary: { lengthInMeters: -1 } }] } });
    await expect(getDriveRoute(KEY, dep, dest, arriveAt, now, 'America/New_York')).rejects.toThrow('route_invalid');
  });
});

describe('getTrafficData', () => {
  const flow = { flowSegmentData: { currentSpeed: 30, freeFlowSpeed: 40, currentTravelTime: 60, freeFlowTravelTime: 45, confidence: 1 } };

  it('returns both flows and incidents, each call with a 5 s timeout', async () => {
    get.mockResolvedValueOnce({ data: flow }).mockResolvedValueOnce({ data: flow }).mockResolvedValueOnce({ data: { incidents: [] } });
    const result = await getTrafficData(KEY, dep, dest);
    expect(result).toEqual({ flows: [flow.flowSegmentData, flow.flowSegmentData], incidents: [], degraded: [] });
    expect(get.mock.calls.map(([, config]) => config?.timeout)).toEqual([5000, 5000, 5000]);
  });

  it('settles independently: partial data plus reason codes, never a throw', async () => {
    get.mockResolvedValueOnce({ data: flow }).mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce(new Error('down'));
    const result = await getTrafficData(KEY, dep, dest);
    expect(result).toEqual({
      flows: [flow.flowSegmentData, null],
      incidents: null,
      degraded: ['traffic_flow_unavailable', 'incidents_unavailable'],
    });
  });
});
