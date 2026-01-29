import { DaemonMcpToolManager } from '../../server/DaemonMcpToolManager';
import { SessionManager } from '../../server/SessionManager';
import { DaemonQueryExecutor } from '../../server/DaemonQueryExecutor';

// Mock dependencies
jest.mock('../../server/SessionManager');
jest.mock('../../server/DaemonQueryExecutor');

describe('DaemonMcpToolManager', () => {
  let toolManager: DaemonMcpToolManager;
  let mockSessionManager: jest.Mocked<SessionManager>;
  let mockQueryExecutor: jest.Mocked<DaemonQueryExecutor>;

  beforeEach(() => {
    mockSessionManager = new SessionManager() as jest.Mocked<SessionManager>;
    mockQueryExecutor = new DaemonQueryExecutor(
      {} as any,
      {} as any
    ) as jest.Mocked<DaemonQueryExecutor>;

    // Setup default mock behaviors
    mockSessionManager.getAllSessions.mockReturnValue([]);
    mockSessionManager.registerSession.mockReturnValue({} as any);

    toolManager = new DaemonMcpToolManager(mockSessionManager, mockQueryExecutor);
  });

  it('should return a list of 4 tools (run_query, get_tab_info, list_sessions, cancel_query)', () => {
    const tools = toolManager.getTools();
    expect(tools).toHaveLength(4);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('run_query');
    expect(toolNames).toContain('get_tab_info');
    expect(toolNames).toContain('list_sessions');
    expect(toolNames).toContain('cancel_query');
    // register_session should NOT be in the public tool list
    expect(toolNames).not.toContain('register_session');
  });

  it('should auto-register session on run_query if session does not exist', async () => {
    // First call returns null (session doesn't exist), second call returns the session
    const mockSession = {
      id: 'new-session',
      displayName: 'MCP Client',
      clientType: 'standalone',
      tabs: new Map(),
      activeTabId: undefined,
      lastActivityAt: new Date(),
      abortControllers: new Map(),
    };
    mockSessionManager.getSession
      .mockReturnValueOnce(undefined) // First call: not found
      .mockReturnValueOnce(mockSession as any); // After registration

    mockQueryExecutor.execute.mockImplementation(async function* () {
      yield { columns: [], data: [] };
    });

    const result: any = await toolManager.handleToolCall('run_query', {
      sql: 'SELECT 1',
      session: 'new-session',
      displayName: 'My New Session',
    });

    // Should have auto-registered the session
    expect(mockSessionManager.registerSession).toHaveBeenCalledWith(
      'new-session',
      'My New Session',
      'standalone'
    );
    expect(result.content[0].text).toContain('Query submitted');
  });

  it('should use default displayName when auto-registering', async () => {
    const mockSession = {
      id: 'test-session',
      displayName: 'MCP Client',
      clientType: 'standalone',
      tabs: new Map(),
      activeTabId: undefined,
      lastActivityAt: new Date(),
      abortControllers: new Map(),
    };
    mockSessionManager.getSession
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(mockSession as any);

    mockQueryExecutor.execute.mockImplementation(async function* () {
      yield { columns: [], data: [] };
    });

    await toolManager.handleToolCall('run_query', {
      sql: 'SELECT 1',
      session: 'test-session',
      // No displayName provided - should default to 'MCP Client'
    });

    expect(mockSessionManager.registerSession).toHaveBeenCalledWith(
      'test-session',
      'MCP Client', // Default value
      'standalone'
    );
  });

  it('should handle list_sessions', async () => {
    mockSessionManager.getAllSessions.mockReturnValue([
      { id: 's1', displayName: 'Session 1', clientType: 'vscode', tabs: new Map() } as any,
    ]);

    const result: any = await toolManager.handleToolCall('list_sessions', {});
    const content = JSON.parse(result.content[0].text);

    expect(content).toHaveLength(1);
    expect(content[0].id).toBe('s1');
  });

  it('should throw error for unknown tool', async () => {
    await expect(toolManager.handleToolCall('unknown_tool', {})).rejects.toThrow('Unknown tool');
  });

  it('should throw error for register_session (no longer a public tool)', async () => {
    await expect(
      toolManager.handleToolCall('register_session', {
        sessionId: 'test',
        displayName: 'Test',
        clientType: 'vscode',
      })
    ).rejects.toThrow('Unknown tool');
  });
});
