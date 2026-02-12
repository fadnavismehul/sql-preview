/**
 * Tokenizes SQL text into statements and their ranges.
 */
export function* iterateSqlStatements(text: string): Generator<{
  statement: string;
  start: number;
  end: number;
  executionStart: number;
  executionEnd: number;
}> {
  let currentStart = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  // Pre-compiled regex for finding first non-whitespace char
  // global flag is needed to use lastIndex
  const nonWhitespaceRegex = /\S/g;

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
        nonWhitespaceRegex.lastIndex = currentStart;
        const match = nonWhitespaceRegex.exec(text);

        if (match && match.index < i) {
          const executionStart = match.index;
          let executionEnd = i;
          while (executionEnd > executionStart && isWhitespace(text.charCodeAt(executionEnd - 1))) {
            executionEnd--;
          }

          const statement = text.substring(executionStart, executionEnd);
          yield {
            statement,
            start: currentStart,
            end: i,
            executionStart,
            executionEnd,
          };
        }
        currentStart = i + 1;
      }
    }
  }

  // Yield last statement
  if (currentStart < text.length) {
    nonWhitespaceRegex.lastIndex = currentStart;
    const match = nonWhitespaceRegex.exec(text);

    if (match) {
      const executionStart = match.index;
      let executionEnd = text.length;
      while (executionEnd > executionStart && isWhitespace(text.charCodeAt(executionEnd - 1))) {
        executionEnd--;
      }

      const statement = text.substring(executionStart, executionEnd);
      yield {
        statement,
        start: currentStart,
        end: text.length,
        executionStart,
        executionEnd,
      };
    }
  }
}

/**
 * Checks if a character code represents a whitespace character.
 * optimization: checks only common whitespace characters (Space, Tab, LF, CR, NBSP)
 */
function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 160;
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
  if (offset > text.length || offset < 0) {
    return null;
  }

  let lastStatement: string | null = null;
  let lastEnd = 0;

  for (const { statement, start, end } of iterateSqlStatements(text)) {
    // Check if offset is within the range [start, end] (inclusive of delimiter or end of file)
    // We use a loose check to allow cursor at the immediate end of the query
    if (offset >= start && offset <= end + 1) {
      return statement;
    }
    lastStatement = statement;
    lastEnd = end;
  }

  // Handle trailing whitespace/semicolons after the last statement
  if (lastStatement !== null && offset > lastEnd) {
    const trailing = text.substring(lastEnd, offset);
    // If the trailing text contains only whitespace or semicolons, attach to previous statement
    if (!/[^;\s]/.test(trailing)) {
      return lastStatement;
    }
  }

  return null;
}
