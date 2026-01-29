import JSONBig from 'json-bigint';

// Configure to return BigNumber objects instead of strings immediately
const jsonBig = JSONBig({ storeAsString: false, strict: true });

/**
 * Recursively converts BigNumber objects to native Numbers (if safe) or Strings.
 */
function convertBigNumbers(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(convertBigNumbers);
  }

  if (typeof obj === 'object') {
    // Check if it's a BigNumber using duck typing (checking structure properties)
    // json-bigint uses bignumber.js instances which have s (sign), e (exponent), c (coefficient)
    if (
      obj &&
      typeof obj === 'object' &&
      's' in obj &&
      'e' in obj &&
      'c' in obj &&
      Array.isArray(obj.c)
    ) {
      const str = obj.toString();
      const num = Number(str);
      // Use MAX_SAFE_INTEGER check for reliable precision detection
      // String comparison fails for scientific notation (1e+20 vs 100000000000000000000)
      if (Number.isFinite(num) && Math.abs(num) <= Number.MAX_SAFE_INTEGER) {
        return num;
      }
      // Keep as string to preserve precision for very large numbers
      return str;
    }

    const result: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = convertBigNumbers(obj[key]);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Robust JSON parser that handles BigInts by preserving them as strings.
 * This is crucial for Trino/Presto query results which often contain 64-bit integers.
 */
export function safeJsonParse<T = unknown>(text: string): T {
  try {
    const parsed = jsonBig.parse(text);
    return convertBigNumbers(parsed) as T;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`JSON Parse Error: ${error.message}`);
    }
    throw new Error('JSON Parse Error: Unknown error');
  }
}

/**
 * Robust JSON stringifier that handles BigInts correctly.
 */
export function safeJsonStringify(value: unknown): string {
  // JSONBig.stringify handles BigInts automatically
  return jsonBig.stringify(value);
}
