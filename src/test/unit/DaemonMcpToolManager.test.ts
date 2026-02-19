import { DaemonMcpToolManager } from '../../server/DaemonMcpToolManager';
import { SessionManager } from '../../server/SessionManager';
import { DaemonQueryExecutor } from '../../server/DaemonQueryExecutor';
import { QueryPage } from '../../common/types';
import { ConnectionManager } from '../../server/connection/ConnectionManager';

// Mock dependencies
jest.mock('../../server/SessionManager');
jest.mock('../../server/DaemonQueryExecutor');
jest.mock('../../server/connection/ConnectionManager');

describe('DaemonMcpToolManager', () => {
  let manager: DaemonMcpToolManager;
  let sessionManager: jest.Mocked<SessionManager>;
  let queryExecutor: jest.Mocked<DaemonQueryExecutor>;
  let connectionManager: jest.Mocked<ConnectionManager>;
  let mockSession: any;

  beforeEach(() => {
    // Instantiate mocks
    sessionManager = new SessionManager({} as any) as jest.Mocked<SessionManager>;
    queryExecutor = new DaemonQueryExecutor(
      null as any,
      null as any,
      null as any
    ) as jest.Mocked<DaemonQueryExecutor>;
    connectionManager = new ConnectionManager([], null as any) as jest.Mocked<ConnectionManager>;

    manager = new DaemonMcpToolManager(sessionManager, queryExecutor, connectionManager);

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
    sessionManager.addTab.mockImplementation((_id, tab) => {
      mockSession.tabs.set(tab.id, tab);
    });
  });

  describe('getTools', () => {
    it('should not list close_tab tool (hidden)', () => {
      const tools = manager.getTools();
      const closeTab = tools.find(t => t.name === 'close_tab');
      expect(closeTab).toBeUndefined();
    });

    it('should list run_query and get_tab_info', () => {
      const tools = manager.getTools();
      expect(tools.find(t => t.name === 'run_query')).toBeDefined();
      expect(tools.find(t => t.name === 'get_tab_info')).toBeDefined();
    });
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

      expect(result.content[0].text).toContain('Query started');
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

      expect(result.content[0].text).toContain('Failed to auto-register session');
    });

    it('should pass connectionProfile to queryExecutor', async () => {
      const profile = { type: 'trino', host: 'localhost', user: 'admin', password: 'pw' };

      await manager.handleToolCall('run_query', {
        sql: 'SELECT 1',
        session: 'session1',
        connectionProfile: profile,
      });

      expect(queryExecutor.execute).toHaveBeenCalledWith(
        'SELECT 1',
        'session1',
        undefined,
        expect.anything(),
        profile
      );
    });
  });

  describe('close_tab', () => {
    it('should remove tab from session', async () => {
      const tab = { id: 'tab1' };
      mockSession.tabs.set('tab1', tab);

      const result: any = await manager.handleToolCall('close_tab', {
        session: 'session1',
        tabId: 'tab1',
      });

      expect(sessionManager.removeTab).toHaveBeenCalledWith('session1', 'tab1');
      expect(result.content[0].text).toContain('Tab tab1 closed');
    });

    it('should throw error if session not found', async () => {
      sessionManager.getSession.mockReturnValue(undefined);

      await expect(
        manager.handleToolCall('close_tab', {
          session: 'session1',
          tabId: 'tab1',
        })
      ).rejects.toThrow('Session not found');
    });

    it('should throw error if params missing', async () => {
      await expect(manager.handleToolCall('close_tab', { session: 'session1' })).rejects.toThrow(
        'Session ID and Tab ID required'
      );
    });
  });

  describe('get_tab_info', () => {
    it('should return preview summary by default', async () => {
      const tab = {
        id: 'tab1',
        title: 'Result',
        status: 'success',
        rows: Array(20).fill(['val']), // 20 rows
        columns: [{ name: 'col', type: 'varchar' }],
      };
      mockSession.tabs.set('tab1', tab);

      const result: any = await manager.handleToolCall('get_tab_info', {
        session: 'session1',
        tabId: 'tab1',
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.meta).toBeDefined();
      expect(content.meta.totalRows).toBe(20);
      expect(content.preview).toHaveLength(10); // Default preview limit
      expect(content.message).toContain('Showing 10 of 20 rows');
      expect(content.resourceUri).toContain('sql-preview://sessions/session1/tabs/tab1');
    });

    it('should return page of rows when mode="page"', async () => {
      const tab = {
        id: 'tab1',
        title: 'Result', // title is in page mode
        status: 'success',
        rows: Array(20).fill(['val']),
        columns: [{ name: 'col', type: 'varchar' }],
      };
      mockSession.tabs.set('tab1', tab);

      const result: any = await manager.handleToolCall('get_tab_info', {
        session: 'session1',
        tabId: 'tab1',
        mode: 'page',
        limit: 5,
        offset: 5,
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.rows).toHaveLength(5);
      expect(content.offset).toBe(5);
      expect(content.limit).toBe(5);
      expect(content.hasMore).toBe(true);
      expect(content.meta.totalRows).toBe(20);
    });

    it('should default to active tab', async () => {
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
      // In preview mode, id is not at root, but resourceUri contains it
      expect(content.resourceUri).toContain('tab1');
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
      expect(list[0].tabs).toBeDefined();
      expect(Array.isArray(list[0].tabs)).toBe(true);
    });
  });

  describe('list_connections', () => {
    it('should list connections with full details excluding password', async () => {
      const mockProfiles = [
        {
          id: '1',
          name: 'Test',
          type: 'trino',
          host: 'localhost',
          port: 8080,
          user: 'test',
          password: 'pwd',
        },
      ];
      (connectionManager.getProfiles as jest.Mock).mockResolvedValue(mockProfiles);

      const result: any = await manager.handleToolCall('list_connections', {});
      const connections = JSON.parse(result.content[0].text);

      expect(connections).toHaveLength(1);
      expect(connections[0]).toEqual({
        id: '1',
        name: 'Test',
        type: 'trino',
        host: 'localhost',
        port: 8080,
        user: 'test',
      });
      expect(connections[0].password).toBeUndefined();
    });
  });
});
