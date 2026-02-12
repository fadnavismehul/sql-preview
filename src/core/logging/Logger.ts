import * as vscode from 'vscode';
import { LogLevel } from '../../common/types';

export interface LoggerOptions {
  outputChannelName: string;
  logLevel: LogLevel;
}

export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel;

  private constructor(options: LoggerOptions) {
    this.outputChannel = vscode.window.createOutputChannel(options.outputChannelName);
    this.logLevel = options.logLevel;
  }

  public static initialize(options: LoggerOptions): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(options);
    }
    return Logger.instance;
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      // Fallback initialization if not manually initialized (e.g. tests)
      Logger.instance = new Logger({
        outputChannelName: 'SQL Preview',
        logLevel: LogLevel.INFO,
      });
    }
    return Logger.instance;
  }

  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  public getOutputChannel(): vscode.OutputChannel {
    return this.outputChannel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    data?: unknown,
    correlationId?: string
  ): string {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] [${level}]`;

    if (correlationId) {
      logMsg += ` [${correlationId}]`;
    }

    logMsg += ` ${message}`;

    if (data) {
      // Safely stringify data
      try {
        if (data instanceof Error) {
          logMsg += `\nStack: ${data.stack}`;
        } else {
          const json = JSON.stringify(data, null, 2);
          logMsg += `\nData: ${json}`;
        }
      } catch (err) {
        logMsg += `\nData: [Circular or Unserializable]`;
      }
    }

    return logMsg;
  }

  public debug(message: string, data?: unknown, correlationId?: string): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const msg = this.formatMessage(LogLevel.DEBUG, message, data, correlationId);
      this.outputChannel.appendLine(msg);
    }
  }

  public info(message: string, data?: unknown, correlationId?: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const msg = this.formatMessage(LogLevel.INFO, message, data, correlationId);
      this.outputChannel.appendLine(msg);
    }
  }

  public warn(message: string, error?: unknown, correlationId?: string): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const msg = this.formatMessage(LogLevel.WARN, message, error, correlationId);
      this.outputChannel.appendLine(msg);
    }
  }

  public error(message: string, error?: unknown, correlationId?: string): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const msg = this.formatMessage(LogLevel.ERROR, message, error, correlationId);
      this.outputChannel.appendLine(msg);
      this.outputChannel.show(true); // Bring to front on error
    }
  }
}
