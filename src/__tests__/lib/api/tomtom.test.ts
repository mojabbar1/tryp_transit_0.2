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
      
      // Format: minLat,minLng,maxLat,maxLng
      expect(result).toBe('32.7764,-79.9353,32.7913,-79.9301');
    });

    it('should handle reversed coordinates (destination north of departure)', () => {
      const departure = { lat: 32.7764, lng: -79.9301 };
      const destination = { lat: 32.7913, lng: -79.9353 };
      
      const result = calculateBbox(departure, destination);
      
      // Should still produce same bbox regardless of order
      expect(result).toBe('32.7764,-79.9353,32.7913,-79.9301');
    });

    it('should handle same point (zero-area bbox)', () => {
      const point = { lat: 32.7800, lng: -79.9300 };
      
      const result = calculateBbox(point, point);
      
      expect(result).toBe('32.78,-79.93,32.78,-79.93');
    });

    it('should handle negative latitudes (southern hemisphere)', () => {
      const departure = { lat: -33.8688, lng: 151.2093 }; // Sydney
      const destination = { lat: -33.9173, lng: 151.2313 };
      
      const result = calculateBbox(departure, destination);
      
      expect(result).toBe('-33.9173,151.2093,-33.8688,151.2313');
    });

    it('should handle cross-hemisphere routes', () => {
      const departure = { lat: 1.3521, lng: 103.8198 }; // Singapore
      const destination = { lat: -6.2088, lng: 106.8456 }; // Jakarta
      
      const result = calculateBbox(departure, destination);
      
      expect(result).toBe('-6.2088,103.8198,1.3521,106.8456');
    });
  });
});
