/* eslint-disable no-console */

export class ConsoleLogger {
  private static instance: ConsoleLogger;

  public static getInstance(): ConsoleLogger {
    if (!ConsoleLogger.instance) {
      ConsoleLogger.instance = new ConsoleLogger();
    }
    return ConsoleLogger.instance;
  }

  public info(message: string, data?: unknown) {
    console.log(`[INFO] ${message}`, data ? JSON.stringify(data) : '');
  }

  public error(message: string, error?: unknown) {
    console.error(`[ERROR] ${message}`, error);
  }

  public warn(message: string, data?: unknown) {
    console.warn(`[WARN] ${message}`, data ? JSON.stringify(data) : '');
  }

  public debug(message: string, data?: unknown) {
    // Only log debug if env var set?
    if (process.env.DEBUG) {
      console.debug(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
    }
  }
}

export const logger = ConsoleLogger.getInstance();
