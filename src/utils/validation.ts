export function validatePort(port: unknown): number {
  let num: number;

  if (typeof port === 'number') {
    num = port;
  } else if (typeof port === 'string') {
    const trimmed = port.trim();
    // Strict check: only digits allowed
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid port format: "${port}"`);
    }
    num = parseInt(trimmed, 10);
  } else {
    throw new Error(`Invalid port type: ${typeof port}`);
  }

  if (!Number.isInteger(num)) {
    throw new Error(`Port must be an integer: ${num}`);
  }

  if (num < 1 || num > 65535) {
    throw new Error(`Port out of range (1-65535): ${num}`);
  }

  return num;
}
