import { SessionManager } from '../../server/SessionManager';
import { ILogger } from '../../common/logger';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  const mockLogger: ILogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(() => {
    sessionManager = new SessionManager(mockLogger);
  });

  it('should register a new session', () => {
    const session = sessionManager.registerSession('session1', 'user1', 'vscode');

    expect(session).toBeDefined();
    expect(session.id).toBe('session1');
    expect(session.displayName).toBe('user1');
    expect(session.clientType).toBe('vscode');
    expect(sessionManager.getSession('session1')).toBe(session);
  });

  it('should update existing session on re-registration', async () => {
    const session1 = sessionManager.registerSession('session1', 'user1', 'vscode');
    const initialConnectedAt = session1.connectedAt;

    // Wait a small amount to ensure time difference
    await new Promise(resolve => setTimeout(resolve, 10));

    const session2 = sessionManager.registerSession('session1', 'user1', 'vscode');

    expect(session2).toBe(session1);
    expect(session2.connectedAt.getTime()).toBeGreaterThan(initialConnectedAt.getTime());
  });

  it('should prune old sessions when MAX_SESSIONS is reached', () => {
    // Mock constant MAX_SESSIONS by filling it up
    // Since MAX_SESSIONS is private and 50, we need to add 50 sessions
    // This might be slow if we literally add 50, but let's assume it's fast enough for unit tests.

    // Populate 50 sessions
    for (let i = 0; i < 50; i++) {
      const session = sessionManager.registerSession(`session_${i}`, `User ${i}`, 'vscode');
      // Artificially space out lastActivityAt to ensure deterministic pruning
      session.lastActivityAt = new Date(Date.now() - (100000 - i * 1000));
    }

    expect(sessionManager.getAllSessions().length).toBe(50);

    // Add one more session
    sessionManager.registerSession('new_session', 'New User', 'vscode');

    // Should prune 10% (5) sessions, so we should have 50 - 5 + 1 = 46 sessions?
    // Wait, logic says:
    // const countToRemove = Math.max(1, Math.ceil(this.sessions.size * 0.1));
    // this.sessions.size is 50. 0.1 * 50 = 5.
    // So it removes 5 sessions.
    // Then adds 1.
    // Final count should be 50 - 5 + 1 = 46.

    const sessions = sessionManager.getAllSessions();
    expect(sessions.length).toBe(46);

    // Verify 'new_session' exists
    expect(sessionManager.getSession('new_session')).toBeDefined();

    // Verify oldest session (session_0) is gone
    expect(sessionManager.getSession('session_0')).toBeUndefined();
  });

  it('should correctly check if tab can be added', () => {
    const session = sessionManager.registerSession('session1', 'user1', 'vscode');

    // Initially empty
    expect(sessionManager.canAddTab('session1')).toBe(true);

    // Add 20 tabs (MAX_TABS_PER_SESSION)
    // Since tabs is a public Map, we can manipulate it directly for testing
    for (let i = 0; i < 20; i++) {
      session.tabs.set(`tab_${i}`, {
        id: `tab_${i}`,
        title: `Tab ${i}`,
        query: 'SELECT 1',
        columns: [],
        rows: [],
        status: 'success',
      });
    }

    expect(sessionManager.canAddTab('session1')).toBe(false);
  });

  it('should return false for canAddTab if session does not exist', () => {
    expect(sessionManager.canAddTab('non_existent')).toBe(false);
  });

  it('should remove session', () => {
    sessionManager.registerSession('session1', 'user1', 'vscode');
    expect(sessionManager.getSession('session1')).toBeDefined();

    sessionManager.removeSession('session1');
    expect(sessionManager.getSession('session1')).toBeUndefined();
  });

  it('should touch session and update lastActivityAt', async () => {
    const session = sessionManager.registerSession('session1', 'user1', 'vscode');
    const initialActivity = session.lastActivityAt;

    await new Promise(resolve => setTimeout(resolve, 10));

    sessionManager.touchSession('session1');
    expect(session.lastActivityAt.getTime()).toBeGreaterThan(initialActivity.getTime());
  });

  describe('removeTab', () => {
    it('should remove tab and emit event', () => {
      const session = sessionManager.registerSession('session1', 'user1', 'vscode');
      const tab = { id: 'tab1', title: 'Start', status: 'success' } as any;
      session.tabs.set('tab1', tab);

      const emitSpy = jest.fn();
      sessionManager.on('tab-removed', emitSpy);

      sessionManager.removeTab('session1', 'tab1');

      expect(session.tabs.has('tab1')).toBe(false);
      expect(emitSpy).toHaveBeenCalledWith({ sessionId: 'session1', tabId: 'tab1' });
    });

    it('should ignore if session or tab not found', () => {
      const emitSpy = jest.fn();
      sessionManager.on('tab-removed', emitSpy);

      sessionManager.removeTab('non-existent', 'tab1');
      expect(emitSpy).not.toHaveBeenCalled();

      sessionManager.registerSession('session1', 'user1', 'vscode');
      sessionManager.removeTab('session1', 'tab-not-there');
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('addTab', () => {
    it('should add tab and emit event', () => {
      const session = sessionManager.registerSession('session1', 'user1', 'vscode');
      const tab = { id: 'tab1', title: 'Start', status: 'success' } as any;

      const emitSpy = jest.fn();
      sessionManager.on('tab-added', emitSpy);

      sessionManager.addTab('session1', tab);

      expect(session.tabs.has('tab1')).toBe(true);
      expect(session.tabs.get('tab1')).toBe(tab);
      expect(emitSpy).toHaveBeenCalledWith({ sessionId: 'session1', tab });
    });

    it('should update session lastActivityAt', async () => {
      const session = sessionManager.registerSession('session1', 'user1', 'vscode');
      const initialActivity = session.lastActivityAt;

      await new Promise(resolve => setTimeout(resolve, 10));

      sessionManager.addTab('session1', { id: 'tab1' } as any);

      expect(session.lastActivityAt.getTime()).toBeGreaterThan(initialActivity.getTime());
    });

    it('should do nothing if session does not exist', () => {
      const emitSpy = jest.fn();
      sessionManager.on('tab-added', emitSpy);

      sessionManager.addTab('non-existent', { id: 'tab1' } as any);

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('updateTab', () => {
    it('should update tab and emit event', () => {
      const session = sessionManager.registerSession('session1', 'user1', 'vscode');
      const tab = { id: 'tab1', title: 'Old Title', status: 'success' } as any;
      session.tabs.set('tab1', tab);

      const emitSpy = jest.fn();
      sessionManager.on('tab-updated', emitSpy);

      sessionManager.updateTab('session1', 'tab1', { title: 'New Title' });

      expect(session.tabs.get('tab1')!.title).toBe('New Title');
      expect(emitSpy).toHaveBeenCalledWith({
        sessionId: 'session1',
        tabId: 'tab1',
        tab: expect.objectContaining({ title: 'New Title' }),
      });
    });

    it('should do nothing if session or tab not found', () => {
      const emitSpy = jest.fn();
      sessionManager.on('tab-updated', emitSpy);

      sessionManager.updateTab('non-existent', 'tab1', {});
      expect(emitSpy).not.toHaveBeenCalled();

      sessionManager.registerSession('session1', 'user1', 'vscode');
      sessionManager.updateTab('session1', 'tab-not-there', {});
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });
});
