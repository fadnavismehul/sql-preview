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

  it('should return a list of tools', () => {
    const tools = toolManager.getTools();
    expect(tools).toHaveLength(5);
    expect(tools.map(t => t.name)).toContain('run_query');
    expect(tools.map(t => t.name)).toContain('list_sessions');
  });

  it('should register a session', async () => {
    const result = await toolManager.handleToolCall('register_session', {
      sessionId: 'test-session',
      displayName: 'Test Client',
      clientType: 'vscode',
    });

    expect(mockSessionManager.registerSession).toHaveBeenCalledWith(
      'test-session',
      'Test Client',
      'vscode'
    );
    expect((result as any).content[0].text).toContain('registered successfully');
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
});
