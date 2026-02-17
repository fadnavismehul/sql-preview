import { LogLevel } from '../common/types';
import { ILogger } from '../common/logger';

export class ConsoleLogger implements ILogger {
  private static instance: ConsoleLogger;
  private logLevel: LogLevel = LogLevel.INFO;

  private constructor() {
    const envLevel = process.env['SQL_PREVIEW_LOG_LEVEL'];
    if (envLevel && Object.values(LogLevel).includes(envLevel as LogLevel)) {
      this.logLevel = envLevel as LogLevel;
    }
  }

  private useStdErr = false;

  public static getInstance(): ConsoleLogger {
    if (!ConsoleLogger.instance) {
      ConsoleLogger.instance = new ConsoleLogger();
    }
    return ConsoleLogger.instance;
  }

  public setUseStdErr(use: boolean) {
    this.useStdErr = use;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  public info(message: string, data?: unknown) {
    if (this.shouldLog(LogLevel.INFO)) {
      const msg = `[INFO] ${message} ${data ? JSON.stringify(data) : ''}`;
      if (this.useStdErr) {
        console.error(msg);
      } else {
        console.log(msg);
      }
    }
  }

  public error(message: string, error?: unknown) {
    if (this.shouldLog(LogLevel.ERROR)) {
      const msg = `[ERROR] ${message} ${error ? JSON.stringify(error) : ''}`;
      console.error(msg);
    }
  }

  public warn(message: string, data?: unknown) {
    if (this.shouldLog(LogLevel.WARN)) {
      const msg = `[WARN] ${message} ${data ? JSON.stringify(data) : ''}`;
      console.warn(msg);
    }
  }

  public debug(message: string, data?: unknown) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const msg = `[DEBUG] ${message} ${data ? JSON.stringify(data) : ''}`;
      if (this.useStdErr) {
        console.error(msg);
      } else {
        console.debug(msg);
      }
    }
  }
}

export const logger = ConsoleLogger.getInstance();
