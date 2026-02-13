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
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);

    if (inLineComment) {
      if (code === 10) { // \n
        inLineComment = false;
      }
    } else if (inBlockComment) {
      if (code === 42 && text.charCodeAt(i + 1) === 47) { // * and /
        inBlockComment = false;
        i++;
      }
    } else if (inSingleQuote) {
      if (code === 39 && text.charCodeAt(i - 1) !== 92) { // ' and not escaped
        if (text.charCodeAt(i + 1) === 39) { // '
          i++; // Skip escaped quote
        } else {
          inSingleQuote = false;
        }
      }
    } else if (inDoubleQuote) {
      if (code === 34 && text.charCodeAt(i - 1) !== 92) { // " and not escaped
        if (text.charCodeAt(i + 1) === 34) { // "
          i++; // Skip escaped quote
        } else {
          inDoubleQuote = false;
        }
      }
    } else {
      if (code === 45) { // -
        if (text.charCodeAt(i + 1) === 45) { // -
          inLineComment = true;
        }
      } else if (code === 47) { // /
        if (text.charCodeAt(i + 1) === 42) { // *
          inBlockComment = true;
        }
      } else if (code === 39) { // '
        inSingleQuote = true;
      } else if (code === 34) { // "
        inDoubleQuote = true;
      } else if (code === 59) { // ;
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
  if (currentStart < len) {
    nonWhitespaceRegex.lastIndex = currentStart;
    const match = nonWhitespaceRegex.exec(text);

    if (match) {
      const executionStart = match.index;
      let executionEnd = len;
      while (executionEnd > executionStart && isWhitespace(text.charCodeAt(executionEnd - 1))) {
        executionEnd--;
      }

      const statement = text.substring(executionStart, executionEnd);
      yield {
        statement,
        start: currentStart,
        end: len,
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
