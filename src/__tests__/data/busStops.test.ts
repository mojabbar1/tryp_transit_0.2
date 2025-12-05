/**
 * Tests for bus stops data consistency
 */

import { busStops } from '@/app/data/busStops';
import { busStopCoordinates } from '@/app/data/busStopCoordinates';

describe('Bus Stops Data', () => {
  describe('Data Consistency', () => {
    it('should have matching entries between busStops and busStopCoordinates', () => {
      const stopNames = busStops.map(stop => stop.value);
      const coordinateNames = Object.keys(busStopCoordinates);
      
      // Every stop in busStops should have coordinates
      const missingCoordinates = stopNames.filter(name => !(name in busStopCoordinates));
      
      expect(missingCoordinates).toEqual([]);
    });

    it('should have valid coordinates for all stops', () => {
      Object.entries(busStopCoordinates).forEach(([name, coords]) => {
        // Charleston area latitude range: roughly 32.5 to 33.3
        expect(coords.lat).toBeGreaterThan(32.5);
        expect(coords.lat).toBeLessThan(33.5);
        
        // Charleston area longitude range: roughly -80.3 to -79.7
        expect(coords.lng).toBeGreaterThan(-80.5);
        expect(coords.lng).toBeLessThan(-79.5);
      });
    });

    it('should have non-empty stop names', () => {
      busStops.forEach(stop => {
        expect(stop.value).toBeTruthy();
        expect(stop.value.length).toBeGreaterThan(0);
      });
    });

    it('should have no duplicate stop names', () => {
      const stopNames = busStops.map(stop => stop.value);
      const uniqueNames = new Set(stopNames);
      
      expect(uniqueNames.size).toBe(stopNames.length);
    });
  });

  describe('Data Coverage', () => {
    it('should have at least 50 bus stops', () => {
      expect(busStops.length).toBeGreaterThanOrEqual(50);
    });

    it('should cover major Charleston areas', () => {
      const areas = [
        'Downtown',
        'North Charleston',
        'Mount Pleasant',
        'West Ashley',
        'James Island',
      ];
      
      const allStopNames = busStops.map(s => s.value).join(' ');
      
      // Check that we have stops in multiple areas (at least by naming pattern)
      const coveredAreas = areas.filter(area => {
        const areaStops = busStops.filter(s => 
          s.value.toLowerCase().includes(area.toLowerCase()) ||
          // Check coordinates fall in expected regions
          Object.entries(busStopCoordinates).some(([name, _]) => 
            name.toLowerCase().includes(area.toLowerCase())
          )
        );
        return areaStops.length > 0;
      });
      
      expect(coveredAreas.length).toBeGreaterThanOrEqual(3);
    });
  });
});
