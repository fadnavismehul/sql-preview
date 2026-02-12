import { LogLevel } from '../common/types';

export class ConsoleLogger {
  private static instance: ConsoleLogger;
  private logLevel: LogLevel = LogLevel.INFO;

  private constructor() {
    const envLevel = process.env['SQL_PREVIEW_LOG_LEVEL'];
    if (envLevel && Object.values(LogLevel).includes(envLevel as LogLevel)) {
      this.logLevel = envLevel as LogLevel;
    }
  }

  public static getInstance(): ConsoleLogger {
    if (!ConsoleLogger.instance) {
      ConsoleLogger.instance = new ConsoleLogger();
    }
    return ConsoleLogger.instance;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  public info(message: string, data?: unknown) {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(`[INFO] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  public error(message: string, error?: unknown) {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(`[ERROR] ${message}`, error);
    }
  }

  public warn(message: string, data?: unknown) {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(`[WARN] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  public debug(message: string, data?: unknown) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
    }
  }
}

export const logger = ConsoleLogger.getInstance();
