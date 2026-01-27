/**
 * Tokenizes SQL text into statements and their ranges.
 */
export function* iterateSqlStatements(
  text: string
): Generator<{ statement: string; start: number; end: number }> {
  let currentStart = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
    } else if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
    } else if (inSingleQuote) {
      if (char === "'" && text[i - 1] !== '\\') {
        if (nextChar === "'") {
          i++; // Skip escaped quote
        } else {
          inSingleQuote = false;
        }
      }
    } else if (inDoubleQuote) {
      if (char === '"' && text[i - 1] !== '\\') {
        if (nextChar === '"') {
          i++; // Skip escaped quote
        } else {
          inDoubleQuote = false;
        }
      }
    } else {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
      } else if (char === '/' && nextChar === '*') {
        inBlockComment = true;
      } else if (char === "'") {
        inSingleQuote = true;
      } else if (char === '"') {
        inDoubleQuote = true;
      } else if (char === ';') {
        // End of statement
        const statement = text.substring(currentStart, i).trim();
        if (statement.length > 0) {
          yield { statement, start: currentStart, end: i };
        }
        currentStart = i + 1;
      }
    }
  }

  // Yield last statement
  if (currentStart < text.length) {
    const statement = text.substring(currentStart).trim();
    if (statement.length > 0) {
      yield { statement, start: currentStart, end: text.length };
    }
  }
}

/**
 * Splits a SQL text into individual statements, respecting strings and comments.
 */
export function splitSqlQueries(text: string): string[] {
  const queries: string[] = [];
  for (const { statement } of iterateSqlStatements(text)) {
    queries.push(statement);
  }
  return queries;
}

/**
 * Finds the query at a specific offset in the text.
 */
export function getQueryAtOffset(text: string, offset: number): string | null {
  for (const { statement, start, end } of iterateSqlStatements(text)) {
    // Check if offset is within the range [start, end] (inclusive of delimiter or end of file)
    // We use a loose check to allow cursor at the immediate end of the query
    if (offset >= start && offset <= end + 1) {
      return statement;
    }
  }
  return null;
}
