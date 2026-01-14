export class QuerySessionRegistry {
  private sessions: Map<string, AbortController> = new Map();

  /**
   * Creates a new cancellation session for a tab.
   * Aborts any existing session for this tab first.
   */
  public createSession(tabId: string): AbortController {
    this.cancelSession(tabId); // Ensure cleanup
    const controller = new AbortController();
    this.sessions.set(tabId, controller);
    return controller;
  }

  /**
   * Cancels the session for the given tab if it exists.
   */
  public cancelSession(tabId: string): void {
    const controller = this.sessions.get(tabId);
    if (controller) {
      controller.abort();
      this.sessions.delete(tabId);
    }
  }

  /**
   * Simply removes the session (e.g. on successful completion) without aborting.
   */
  public clearSession(tabId: string): void {
    this.sessions.delete(tabId);
  }

  public getSession(tabId: string): AbortController | undefined {
    return this.sessions.get(tabId);
  }
}
