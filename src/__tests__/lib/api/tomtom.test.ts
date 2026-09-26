/**
 * Unit tests for TomTom API utilities
 */

import { calculateBbox } from '@/lib/api/tomtom';

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

describe('TomTom API key resolution', () => {
  const PRIMARY = 'primary-value';
  const LEGACY = 'legacy-value';
  const savedPrimary = process.env.TOMTOM_API_KEY;
  const savedLegacy = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
  let warnSpy: jest.SpyInstance;

  // Load a fresh module per test so the one-time legacy warning resets
  const loadTomTom = () => require('@/lib/api/tomtom') as typeof import('@/lib/api/tomtom');

  beforeEach(() => {
    delete process.env.TOMTOM_API_KEY;
    delete process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
    jest.resetModules();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  afterAll(() => {
    if (savedPrimary === undefined) delete process.env.TOMTOM_API_KEY;
    else process.env.TOMTOM_API_KEY = savedPrimary;
    if (savedLegacy === undefined) delete process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
    else process.env.NEXT_PUBLIC_TOMTOM_API_KEY = savedLegacy;
  });

  it('prefers the server-only TOMTOM_API_KEY without warning', () => {
    process.env.TOMTOM_API_KEY = PRIMARY;
    process.env.NEXT_PUBLIC_TOMTOM_API_KEY = LEGACY;
    const { getTomTomApiKey, isTomTomConfigured } = loadTomTom();

    expect(getTomTomApiKey()).toBe(PRIMARY);
    expect(isTomTomConfigured()).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the legacy NEXT_PUBLIC_TOMTOM_API_KEY and warns only once', () => {
    process.env.NEXT_PUBLIC_TOMTOM_API_KEY = LEGACY;
    const { getTomTomApiKey, isTomTomConfigured } = loadTomTom();

    expect(getTomTomApiKey()).toBe(LEGACY);
    expect(getTomTomApiKey()).toBe(LEGACY);
    expect(isTomTomConfigured()).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('TOMTOM_API_KEY');
    expect(String(warnSpy.mock.calls[0][0])).not.toContain(LEGACY);
  });

  it('reports not configured when neither name is set', () => {
    const { getTomTomApiKey, isTomTomConfigured } = loadTomTom();

    expect(getTomTomApiKey()).toBeUndefined();
    expect(isTomTomConfigured()).toBe(false);
  });

  it('names TOMTOM_API_KEY in the error when no key is set', async () => {
    const { getTrafficFlow, getIncidents } = loadTomTom();

    await expect(getTrafficFlow({ lat: 32.78, lng: -79.93 })).rejects.toThrow(
      'TOMTOM_API_KEY environment variable is not set'
    );
    await expect(getIncidents('-79.94,32.77,-79.93,32.79')).rejects.toThrow(
      'TOMTOM_API_KEY environment variable is not set'
    );
  });
});
