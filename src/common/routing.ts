/**
 * Detects if a SQL query is targeting a local file (CSV or Parquet).
 * Matches patterns like "FROM 'path/to/file.csv'" or "FROM './file.parquet'".
 * Handles:
 * - Single quotes around file path
 * - .csv and .parquet extensions (case-insensitive)
 * - Optional whitespace around the quoted path
 * - SQL comments (line comments -- and block comments / * * /) between FROM and the file path
 */
export function isFileQuery(query: string): boolean {
  if (!query) {
    return false;
  }
  // Regex to match "FROM 'file.csv'" with support for comments and whitespace
  // Explanation:
  // /from - matches "from" (case-insensitive)
  // (?: ... )* - non-capturing group for whitespace or comments, repeated 0 or more times (changed from + to *)
  //   \s+ - whitespace
  //   | - OR
  //   (?:\s*--[^\n]*\n) - line comment (starts with --, ends with newline) with optional leading whitespace
  //   | - OR
  //   (?:\s*\/\*[\s\S]*?\*\/) - block comment (starts with /*, ends with */) with optional leading whitespace
  // '[^']+\.(csv|parquet)\s*' - matches file path in single quotes with extension and optional trailing whitespace
  const fileQueryRegex =
    /from(?:\s+|(?:\s*--[^\n]*\n)|(?:\s*\/\*[\s\S]*?\*\/))*'[^']+\.(csv|parquet)\s*'/i;

  return fileQueryRegex.test(query);
}
