import JSONBig from 'json-bigint';

// Use strict mode to throw errors on duplicate keys, but always stringify BigInts
const jsonBig = JSONBig({ storeAsString: true, strict: true });

/**
 * Robust JSON parser that handles BigInts by preserving them as strings.
 * This is crucial for Trino/Presto query results which often contain 64-bit integers.
 */
export function safeJsonParse<T = any>(text: string): T {
  try {
    return jsonBig.parse(text) as T;
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
export function safeJsonStringify(value: any): string {
  // JSONBig.stringify handles BigInts automatically
  return jsonBig.stringify(value);
}
