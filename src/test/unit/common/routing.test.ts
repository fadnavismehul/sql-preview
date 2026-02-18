import { isFileQuery } from '../../../common/routing';

describe('Common Routing Logic - isFileQuery', () => {
  // 1. Basic Success Cases
  test('routes basic csv query', () => {
    expect(isFileQuery("SELECT * FROM '~/data.csv'")).toBe(true);
  });

  test('routes basic parquet query', () => {
    expect(isFileQuery("SELECT * FROM './data.parquet'")).toBe(true);
  });

  test('handles case insensitivity', () => {
    expect(isFileQuery("select * from 'DATA.CSV'")).toBe(true);
  });

  // 2. Trailing Spaces (The original bug)
  test('routes query with trailing space inside quotes', () => {
    expect(isFileQuery("SELECT * FROM '~/data.csv '")).toBe(true);
  });

  test('routes query with trailing space outside quotes', () => {
    expect(isFileQuery("SELECT * FROM '~/data.csv' ")).toBe(true);
  });

  // 3. Comments
  test('routes query with line comment between FROM and file', () => {
    expect(isFileQuery("SELECT * FROM -- my comment \n '~/data.csv'")).toBe(true);
  });

  test('routes query with block comment between FROM and file', () => {
    expect(isFileQuery("SELECT * FROM /* comment */ '~/data.csv'")).toBe(true);
  });

  test('routes query with multiline block comment', () => {
    expect(
      isFileQuery(`SELECT * FROM /* 
            multi
            line
        */ '~/data.csv'`)
    ).toBe(true);
  });

  // 4. Whitespace Variations
  test('routes query with newlines', () => {
    expect(isFileQuery("SELECT * \n FROM \n '~/data.csv'")).toBe(true);
  });

  test('routes query with tabs', () => {
    expect(isFileQuery("SELECT * FROM\t'~/data.csv'")).toBe(true);
  });

  test('routes query with no space (tight syntax)', () => {
    expect(isFileQuery("SELECT * FROM'~/data.csv'")).toBe(true);
  });

  // 5. Negative Cases
  test('does not route normal table queries', () => {
    expect(isFileQuery('SELECT * FROM my_table')).toBe(false);
  });

  test('does not route other file extensions', () => {
    expect(isFileQuery("SELECT * FROM 'data.txt'")).toBe(false);
  });

  test('does not route empty string', () => {
    expect(isFileQuery('')).toBe(false);
  });
});
