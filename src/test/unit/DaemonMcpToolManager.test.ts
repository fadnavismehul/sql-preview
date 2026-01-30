import { DaemonMcpToolManager } from '../../server/DaemonMcpToolManager';
import { SessionManager } from '../../server/SessionManager';
import { DaemonQueryExecutor } from '../../server/DaemonQueryExecutor';
import { QueryPage } from '../../common/types';

// Mock dependencies
jest.mock('../../server/SessionManager');
jest.mock('../../server/DaemonQueryExecutor');

describe('DaemonMcpToolManager', () => {
  let manager: DaemonMcpToolManager;
  let sessionManager: jest.Mocked<SessionManager>;
  let queryExecutor: jest.Mocked<DaemonQueryExecutor>;
  let mockSession: any;

  beforeEach(() => {
    // Instantiate mocks
    sessionManager = new SessionManager() as jest.Mocked<SessionManager>;
    queryExecutor = new DaemonQueryExecutor(
      null as any,
      null as any
    ) as jest.Mocked<DaemonQueryExecutor>;

    manager = new DaemonMcpToolManager(sessionManager, queryExecutor);

    mockSession = {
      id: 'session1',
      displayName: 'Test Session',
      tabs: new Map(),
      activeTabId: undefined,
      lastActivityAt: new Date(),
      abortControllers: new Map(),
    };

    sessionManager.getSession.mockReturnValue(mockSession);
    sessionManager.registerSession.mockReturnValue(mockSession);
  });

  describe('run_query', () => {
    it('should execute query and return tab info', async () => {
      // Setup generator for execution
      queryExecutor.execute.mockImplementation(async function* () {
        yield { data: [['val']], columns: [{ name: 'col', type: 'varchar' }] } as QueryPage;
      });

      const result: any = await manager.handleToolCall('run_query', {
        sql: 'SELECT 1',
        session: 'session1',
      });

      expect(result.content[0].text).toContain('Query submitted');
      expect(sessionManager.getSession).toHaveBeenCalledWith('session1');

      // Verify tab creation
      expect(mockSession.tabs.size).toBe(1);
      const tabId = mockSession.activeTabId;
      expect(tabId).toBeDefined();

      // Wait a bit for async execution to likely finish (in real world it's detached promise)
      // Since we mocked execute to yield immediately, we just need to wait for microtasks?
      // The executeAndStore is called without await in handleRunQuery.
      // We can check if execute was called.
      expect(queryExecutor.execute).toHaveBeenCalled();
    });

    it('should auto-register session if not found', async () => {
      sessionManager.getSession.mockReturnValueOnce(undefined).mockReturnValueOnce(mockSession); // First call fails, second succeeds after register

      await manager.handleToolCall('run_query', {
        sql: 'SELECT 1',
        session: 'new_session',
      });

      expect(sessionManager.registerSession).toHaveBeenCalledWith(
        'new_session',
        expect.any(String),
        'standalone'
      );
    });

    it('should throw error if session registration fails', async () => {
      sessionManager.getSession.mockReturnValue(undefined);

      const result: any = await manager.handleToolCall('run_query', {
        sql: 'SELECT 1',
        session: 'fail_session',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to auto-register session');
    });
  });

  describe('get_tab_info', () => {
    it('should return tab info', async () => {
      const tab = {
        id: 'tab1',
        title: 'Result',
        status: 'success',
        rows: [['val']],
        columns: [{ name: 'col', type: 'varchar' }],
      };
      mockSession.tabs.set('tab1', tab);

      const result: any = await manager.handleToolCall('get_tab_info', {
        session: 'session1',
        tabId: 'tab1',
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.id).toBe('tab1');
      expect(content.rowCount).toBe(1);
    });

    it('should return default to active tab', async () => {
      const tab = {
        id: 'tab1',
        rows: [],
      };
      mockSession.tabs.set('tab1', tab);
      mockSession.activeTabId = 'tab1';

      const result: any = await manager.handleToolCall('get_tab_info', {
        session: 'session1',
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.id).toBe('tab1');
    });
  });

  describe('cancel_query', () => {
    it('should cancel running query', async () => {
      const tab = { id: 'tab1', status: 'loading' };
      mockSession.tabs.set('tab1', tab);

      const abortController = new AbortController();
      jest.spyOn(abortController, 'abort');
      mockSession.abortControllers.set('tab1', abortController);

      await manager.handleToolCall('cancel_query', {
        session: 'session1',
        tabId: 'tab1',
      });

      expect(tab.status).toBe('error');
      expect((tab as any).error).toContain('cancelled');
      expect(abortController.abort).toHaveBeenCalled();
    });
  });

  describe('list_sessions', () => {
    it('should list all sessions', async () => {
      sessionManager.getAllSessions.mockReturnValue([mockSession]);

      const result: any = await manager.handleToolCall('list_sessions', {});

      const list = JSON.parse(result.content[0].text);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('session1');
    });
  });
});
