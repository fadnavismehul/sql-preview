/**
 * Character codes for faster parsing
 */
const CHAR_NEWLINE = 10;
const CHAR_ASTERISK = 42;
const CHAR_SLASH = 47;
const CHAR_DASH = 45;
const CHAR_SINGLE_QUOTE = 39;
const CHAR_DOUBLE_QUOTE = 34;
const CHAR_SEMICOLON = 59;
const CHAR_BACKSLASH = 92;
const CHAR_TAB = 9;
const CHAR_CR = 13;
const CHAR_SPACE = 32;
const CHAR_NBSP = 160;

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

  // Cache length for performance
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);

    if (inLineComment) {
      if (code === CHAR_NEWLINE) {
        inLineComment = false;
      }
    } else if (inBlockComment) {
      if (code === CHAR_ASTERISK && text.charCodeAt(i + 1) === CHAR_SLASH) {
        inBlockComment = false;
        i++;
      }
    } else if (inSingleQuote) {
      if (code === CHAR_SINGLE_QUOTE && text.charCodeAt(i - 1) !== CHAR_BACKSLASH) {
        if (text.charCodeAt(i + 1) === CHAR_SINGLE_QUOTE) {
          // '' (escaped quote)
          i++;
        } else {
          inSingleQuote = false;
        }
      }
    } else if (inDoubleQuote) {
      if (code === CHAR_DOUBLE_QUOTE && text.charCodeAt(i - 1) !== CHAR_BACKSLASH) {
        if (text.charCodeAt(i + 1) === CHAR_DOUBLE_QUOTE) {
          // "" (escaped quote)
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
    } else {
      // Normal mode
      if (code === CHAR_DASH && text.charCodeAt(i + 1) === CHAR_DASH) {
        inLineComment = true;
      } else if (code === CHAR_SLASH && text.charCodeAt(i + 1) === CHAR_ASTERISK) {
        inBlockComment = true;
      } else if (code === CHAR_SINGLE_QUOTE) {
        inSingleQuote = true;
      } else if (code === CHAR_DOUBLE_QUOTE) {
        inDoubleQuote = true;
      } else if (code === CHAR_SEMICOLON) {
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
  return (
    code === CHAR_SPACE ||
    code === CHAR_TAB ||
    code === CHAR_NEWLINE ||
    code === CHAR_CR ||
    code === CHAR_NBSP
  );
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
