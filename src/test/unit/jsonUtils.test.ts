import { safeJsonParse } from '../../utils/jsonUtils';

describe('jsonUtils', () => {
  describe('safeJsonParse', () => {
    it('should parse standard JSON', () => {
      const input = '{"a": 1, "b": "string"}';
      const result = safeJsonParse(input);
      expect(result).toEqual({ a: 1, b: 'string' });
    });

    it('should parse large integers as strings', () => {
      const input = '{"id": 1234567890123456789}';
      const result = safeJsonParse<{ id: string }>(input);
      expect(typeof result.id).toBe('string');
      expect(result.id).toBe('1234567890123456789');
    });

    it('should parse doubles as numbers', () => {
      const input = '{"val": 123.456}';
      const result = safeJsonParse<{ val: number }>(input);
      expect(typeof result.val).toBe('number');
      expect(result.val).toBe(123.456);
    });

    it('should parse nested BigNumbers', () => {
      const input = '{"data": [{"id": 9876543210987654321}]}';
      const result = safeJsonParse<{ data: { id: string }[] }>(input);
      expect(result.data).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(result.data![0]!.id).toBe('9876543210987654321');
    });

    it('should handle null and undefined', () => {
      expect(safeJsonParse('null')).toBeNull();
    });

    it('should handle Double values nested in objects (Regression Test)', () => {
      // Simulates the TPV failure case where a double was wrapped in an object
      const input = '{"row": {"amount": 123.456, "currency": "USD"}}';
      const result = safeJsonParse<{ row: { amount: number; currency: string } }>(input);

      expect(result.row.amount).toBe(123.456);
      expect(typeof result.row.amount).toBe('number');
      expect(result.row.currency).toBe('USD');
    });
  });
});
