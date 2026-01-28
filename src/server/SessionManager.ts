import { TabData } from '../common/types';

export interface Session {
  id: string;
  displayName: string;
  clientType: 'vscode' | 'cursor' | 'claude-code' | 'standalone';
  connectedAt: Date;
  lastActivityAt: Date;
  tabs: Map<string, TabData>;
  abortControllers: Map<string, AbortController>;
  activeTabId?: string;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  public registerSession(
    id: string,
    displayName: string,
    clientType: Session['clientType']
  ): Session {
    console.log(`Registering session: ${id} (${clientType})`);

    // Resume existing or create new?
    // For now, always create/update
    let session = this.sessions.get(id);
    if (!session) {
      session = {
        id,
        displayName,
        clientType,
        connectedAt: new Date(),
        lastActivityAt: new Date(),
        tabs: new Map(),
        abortControllers: new Map(),
      };
      this.sessions.set(id, session);
    } else {
      // Update connection info
      session.connectedAt = new Date();
      session.lastActivityAt = new Date();
    }
    return session;
  }

  public getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  public getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  public touchSession(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivityAt = new Date();
    }
  }

  public removeSession(id: string) {
    this.sessions.delete(id);
  }
}
