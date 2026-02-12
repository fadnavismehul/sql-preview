import { TabData } from '../common/types';

import { logger } from './ConsoleLogger';

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

import { EventEmitter } from 'events';

export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private readonly MAX_SESSIONS = 50;
  private readonly MAX_TABS_PER_SESSION = 20;

  public registerSession(
    id: string,
    displayName: string,
    clientType: Session['clientType']
  ): Session {
    logger.info(`Registering session: ${id} (${clientType})`);

    // Resume existing or create new?
    let session = this.sessions.get(id);
    if (!session) {
      // Limit check
      if (this.sessions.size >= this.MAX_SESSIONS) {
        this.pruneSessions();
      }

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

  private pruneSessions() {
    // Basic LRU: remove sessions with oldest activity
    const sorted = Array.from(this.sessions.values()).sort(
      (a, b) => a.lastActivityAt.getTime() - b.lastActivityAt.getTime()
    );

    // Remove oldest 10% or at least 1
    const countToRemove = Math.max(1, Math.ceil(this.sessions.size * 0.1));
    const toRemove = sorted.slice(0, countToRemove);

    for (const s of toRemove) {
      logger.info(`Pruning old session: ${s.id} (Last activity: ${s.lastActivityAt})`);
      this.sessions.delete(s.id);
    }
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

  public canAddTab(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    return session.tabs.size < this.MAX_TABS_PER_SESSION;
  }

  public addTab(sessionId: string, tab: TabData) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.tabs.set(tab.id, tab);
      session.lastActivityAt = new Date();
      this.emit('tab-added', { sessionId, tab });
    }
  }

  public updateTab(sessionId: string, tabId: string, updates: Partial<TabData>) {
    const session = this.sessions.get(sessionId);
    if (session) {
      const tab = session.tabs.get(tabId);
      if (tab) {
        Object.assign(tab, updates);
        session.lastActivityAt = new Date();
        this.emit('tab-updated', { sessionId, tabId, tab });
      }
    }
  }

  public removeTab(sessionId: string, tabId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.tabs.delete(tabId)) {
        session.lastActivityAt = new Date();
        this.emit('tab-removed', { sessionId, tabId });
      }
    }
  }
}
