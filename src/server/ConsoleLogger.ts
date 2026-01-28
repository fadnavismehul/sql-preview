export class ConsoleLogger {
  public info(message: string, data?: unknown) {
    console.log(`[INFO] ${message}`, data ? JSON.stringify(data) : '');
  }

  public error(message: string, error?: unknown) {
    console.error(`[ERROR] ${message}`, error);
  }

  public warn(message: string, data?: unknown) {
    console.warn(`[WARN] ${message}`, data ? JSON.stringify(data) : '');
  }

  public debug() {
    // Only log debug if env var set?
    // console.debug(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
  }
}
