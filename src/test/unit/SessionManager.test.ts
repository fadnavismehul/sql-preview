import { SessionManager } from '../../server/SessionManager';

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
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
});
