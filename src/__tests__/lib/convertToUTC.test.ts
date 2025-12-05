/**
 * Unit tests for convertToUTC utility
 */

import { convertToUTC } from '@/lib/convertToUTC';

describe('convertToUTC', () => {
  // Store original Date to restore after tests
  const RealDate = Date;

  afterEach(() => {
    global.Date = RealDate;
  });

  it('should convert HH:MM to ISO string format', () => {
    const result = convertToUTC('14:30');
    
    // Should be a valid ISO string
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(() => new Date(result)).not.toThrow();
  });

  it('should handle midnight (00:00) correctly', () => {
    const result = convertToUTC('00:00');
    
    expect(result).toBeDefined();
    expect(result).toMatch(/T\d{2}:\d{2}:\d{2}/);
  });

  it('should handle noon (12:00) correctly', () => {
    const result = convertToUTC('12:00');
    
    expect(result).toBeDefined();
    const date = new Date(result);
    expect(date.getHours()).toBe(12);
    expect(date.getMinutes()).toBe(0);
  });

  it('should handle end of day (23:59) correctly', () => {
    const result = convertToUTC('23:59');
    
    expect(result).toBeDefined();
    const date = new Date(result);
    expect(date.getHours()).toBe(23);
    expect(date.getMinutes()).toBe(59);
  });

  it('should roll forward to next day if time is in the past', () => {
    // Mock current time to 15:00
    const mockDate = new Date(2025, 11, 5, 15, 0, 0); // Dec 5, 2025 15:00
    jest.spyOn(global, 'Date').mockImplementation(((...args) => {
      if (args.length === 0) {
        return mockDate;
      }
      return new RealDate(...(args as [number, number, number?, number?, number?, number?, number?]));
    }) as unknown as typeof Date);
    
    // Request time in the past (10:00)
    const result = convertToUTC('10:00');
    const resultDate = new RealDate(result);
    
    // Should be tomorrow
    expect(resultDate.getDate()).toBe(6);
  });

  it('should return today if time is in the future', () => {
    // Mock current time to 10:00
    const mockDate = new Date(2025, 11, 5, 10, 0, 0); // Dec 5, 2025 10:00
    jest.spyOn(global, 'Date').mockImplementation(((...args) => {
      if (args.length === 0) {
        return mockDate;
      }
      return new RealDate(...(args as [number, number, number?, number?, number?, number?, number?]));
    }) as unknown as typeof Date);
    
    // Request time in the future (15:00)
    const result = convertToUTC('15:00');
    const resultDate = new RealDate(result);
    
    // Should be today
    expect(resultDate.getDate()).toBe(5);
  });
});
