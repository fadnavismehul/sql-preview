/**
 * Shared Logger Interface for decoupling server logic from specific implementations.
 * This allows the same core logic to run in VS Code (using OutputChannel)
 * or as a standalone process (using Console).
 */
export interface ILogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}
