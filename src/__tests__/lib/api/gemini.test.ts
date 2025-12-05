/**
 * Unit tests for Gemini API utilities
 */

import { extractJsonFromMarkdown, parseJsonResponse } from '@/lib/api/gemini';

describe('Gemini API Utilities', () => {
  describe('extractJsonFromMarkdown', () => {
    it('should extract JSON from markdown code block', () => {
      const input = '```json\n{"test": "value"}\n```';
      const result = extractJsonFromMarkdown(input);
      
      expect(result).toBe('{"test": "value"}');
    });

    it('should handle JSON with whitespace in code block', () => {
      const input = '```json\n  {\n    "test": "value"\n  }\n```';
      const result = extractJsonFromMarkdown(input);
      
      expect(result).toBe('{\n    "test": "value"\n  }');
    });

    it('should return null for plain text without code blocks', () => {
      const input = '{"test": "value"}';
      const result = extractJsonFromMarkdown(input);
      
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = extractJsonFromMarkdown('');
      
      expect(result).toBeNull();
    });

    it('should handle multiple code blocks and return first JSON one', () => {
      const input = '```javascript\nconsole.log("hi")\n```\n```json\n{"actual": "json"}\n```';
      const result = extractJsonFromMarkdown(input);
      
      expect(result).toBe('{"actual": "json"}');
    });
  });

  describe('parseJsonResponse', () => {
    it('should parse valid JSON directly', () => {
      const input = '{"travelTime": 25, "trafficDensity": "Light"}';
      const result = parseJsonResponse<{ travelTime: number; trafficDensity: string }>(input);
      
      expect(result).toEqual({ travelTime: 25, trafficDensity: 'Light' });
    });

    it('should parse JSON wrapped in markdown code block', () => {
      const input = '```json\n{"travelTime": 30}\n```';
      const result = parseJsonResponse<{ travelTime: number }>(input);
      
      expect(result).toEqual({ travelTime: 30 });
    });

    it('should throw error for invalid JSON', () => {
      const input = 'This is not JSON at all';
      
      expect(() => parseJsonResponse(input)).toThrow();
    });

    it('should throw error for malformed JSON', () => {
      const input = '{"incomplete": ';
      
      expect(() => parseJsonResponse(input)).toThrow();
    });

    it('should handle nested objects', () => {
      const input = '{"incentiveDetails": {"type": "eCredit", "value": "2.00"}}';
      const result = parseJsonResponse<{ incentiveDetails: { type: string; value: string } }>(input);
      
      expect(result.incentiveDetails.type).toBe('eCredit');
      expect(result.incentiveDetails.value).toBe('2.00');
    });

    it('should handle arrays', () => {
      const input = '{"additionalRides": [{"travelTime": 20}, {"travelTime": 25}]}';
      const result = parseJsonResponse<{ additionalRides: Array<{ travelTime: number }> }>(input);
      
      expect(result.additionalRides).toHaveLength(2);
      expect(result.additionalRides[0].travelTime).toBe(20);
    });
  });
});
