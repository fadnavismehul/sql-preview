import { splitSqlQueries, getQueryAtOffset, iterateSqlStatements } from '../../utils/querySplitter';

describe('QuerySplitter', () => {
  describe('splitSqlQueries', () => {
    it('should split simple semicolon separated queries', () => {
      const sql = 'SELECT 1; SELECT 2';
      const queries = splitSqlQueries(sql);
      expect(queries).toHaveLength(2);
      expect(queries[0]).toBe('SELECT 1');
      expect(queries[1]).toBe('SELECT 2');
    });

    it('should handle trailing semicolon gracefully', () => {
      const sql = 'SELECT 1;';
      const queries = splitSqlQueries(sql);
      expect(queries).toHaveLength(1);
      expect(queries[0]).toBe('SELECT 1');
    });

    it('should ignore semicolons in single quoted strings', () => {
      const sql = "SELECT 'val;ue'; SELECT 2";
      const queries = splitSqlQueries(sql);
      expect(queries).toHaveLength(2);
      expect(queries[0]).toBe("SELECT 'val;ue'");
    });

    it('should ignore semicolons in double quoted strings', () => {
      const sql = 'SELECT "val;ue"; SELECT 2';
      const queries = splitSqlQueries(sql);
      expect(queries).toHaveLength(2);
      expect(queries[0]).toBe('SELECT "val;ue"');
    });

    it('should ignore semicolons in line comments', () => {
      const sql = 'SELECT 1 -- comment; with semicolon\n; SELECT 2';
      const queries = splitSqlQueries(sql);
      expect(queries).toHaveLength(2);
      expect(queries[0]).toBe('SELECT 1 -- comment; with semicolon');
      expect(queries[1]).toBe('SELECT 2');
    });

    it('should ignore semicolons in block comments', () => {
      const sql = 'SELECT 1 /* comment; with semicolon */ ; SELECT 2';
      const queries = splitSqlQueries(sql);
      expect(queries).toHaveLength(2);
      expect(queries[0]).toBe('SELECT 1 /* comment; with semicolon */');
    });

    it('should handle escaped quotes', () => {
      const sql = "SELECT 'O\\'Reilly'; SELECT 2";
      const queries = splitSqlQueries(sql);
      expect(queries).toHaveLength(2);
      expect(queries[0]).toBe("SELECT 'O\\'Reilly'");
    });
  });

  describe('getQueryAtOffset', () => {
    const sql = 'SELECT 1; SELECT 2; SELECT 3';
    // Indexes:
    // SELECT 1: 0-8 (length 8)
    // ;: 8
    //  (space): 9
    // SELECT 2: 10-18
    // ;: 18
    //  (space): 19
    // SELECT 3: 20-28

    it('should identify query at start', () => {
      expect(getQueryAtOffset(sql, 0)).toBe('SELECT 1');
      expect(getQueryAtOffset(sql, 5)).toBe('SELECT 1');
    });

    it('should identify query at end boundary', () => {
      // 8 is the semicolon for first query.
      // Our iterator logic:
      // Yields { statement: "...", start: 0, end: 8 } (end index is exclusive in substring but inclusive in loop logic usually)
      // Implementation: yield { statement, start: currentStart, end: i }; where i is index of semicolon.
      // So end is 8.
      // Check: offset >= start && offset <= end + 1
      // 0 >= 0 && 0 <= 9 -> true.
      // 8 >= 0 && 8 <= 9 -> true.
      expect(getQueryAtOffset(sql, 8)).toBe('SELECT 1');
    });

    it('should identify second query', () => {
      expect(getQueryAtOffset(sql, 10)).toBe('SELECT 2');
      expect(getQueryAtOffset(sql, 15)).toBe('SELECT 2');
    });

    it('should identify last query without trailing semicolon', () => {
      expect(getQueryAtOffset(sql, 20)).toBe('SELECT 3');
      expect(getQueryAtOffset(sql, 28)).toBe('SELECT 3');
    });

    it('should handle boundaries and out of bounds', () => {
      // Offset 9 matches "SELECT 1" (end+1) and "SELECT 2" (start). First match wins.
      expect(getQueryAtOffset(sql, 9)).toBe('SELECT 1');

      // True out of bounds
      expect(getQueryAtOffset(sql, -1)).toBeNull();
      expect(getQueryAtOffset(sql, 1000)).toBeNull();
    });
  });

  describe('iterateSqlStatements', () => {
    it('should provide correct execution ranges', () => {
      const sql = '  SELECT 1  ;   SELECT 2';
      // '  SELECT 1  ' -> trimmed 'SELECT 1'
      // 'SELECT 1' starts at index 2, length 8. End at 10.
      // Chunk 1: '  SELECT 1  ' (0 to 12) (semicolon at 12)
      // executionStart: 2
      // executionEnd: 10

      // Chunk 2: '   SELECT 2' (13 to end)
      // '   SELECT 2' starts at 13.
      // 'SELECT 2' starts at 13 + 3 = 16.
      // executionStart: 16
      // executionEnd: 16 + 8 = 24.

      const results = [...iterateSqlStatements(sql)];
      expect(results).toHaveLength(2);

      const first = results[0];
      const second = results[1];

      if (!first || !second) {
        throw new Error('Missing results');
      }

      expect(first.statement).toBe('SELECT 1');
      expect(first.executionStart).toBe(2);
      expect(first.executionEnd).toBe(10);

      expect(second.statement).toBe('SELECT 2');
      expect(second.executionStart).toBe(16);
      expect(second.executionEnd).toBe(24);
    });
  });
});
