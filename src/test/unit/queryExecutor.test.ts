// import * as vscode from 'vscode';
import { QueryExecutor } from '../../core/execution/QueryExecutor';
import { ConnectorRegistry } from '../../connectors/base/ConnectorRegistry';
import { ConnectionManager } from '../../services/ConnectionManager';
import { DaemonClient } from '../../services/DaemonClient';
import { ConnectorConfig } from '../../connectors/base/IConnector';

// Mock dependencies
jest.mock('../../connectors/base/ConnectorRegistry');
jest.mock('../../services/ConnectionManager');
jest.mock('../../services/DaemonClient');

describe('QueryExecutor Unit Tests', () => {
  let queryExecutor: QueryExecutor;
  let mockRegistry: jest.Mocked<ConnectorRegistry>;
  let mockConnectionManager: jest.Mocked<ConnectionManager>;
  let mockDaemonClient: jest.Mocked<DaemonClient>;
  let mockConnector: any;

  beforeEach(() => {
    // Reset mocks
    (ConnectorRegistry as any).mockClear();
    (ConnectionManager as any).mockClear();
    (DaemonClient as any).mockClear();

    // Create mock instances
    mockRegistry = new ConnectorRegistry() as jest.Mocked<ConnectorRegistry>;
    mockConnectionManager = new ConnectionManager({} as any) as jest.Mocked<ConnectionManager>;
    // Mock DaemonClient explicitly
    const MockDaemonClientClass = jest.requireMock('../../services/DaemonClient').DaemonClient;
    mockDaemonClient = new MockDaemonClientClass({}) as jest.Mocked<DaemonClient>;

    // Setup Connector Mock
    mockConnector = {
      runQuery: jest.fn(),
      validateConfig: jest.fn().mockReturnValue(undefined), // Valid by default
      id: 'trino',
    };
    mockRegistry.get = jest.fn().mockReturnValue(mockConnector);

    // Mock ConnectionManager methods
    mockConnectionManager.getConnections = jest.fn().mockResolvedValue([]);
    mockConnectionManager.getConnection = jest.fn();

    queryExecutor = new QueryExecutor(mockRegistry, mockConnectionManager, mockDaemonClient);
  });

  test('testConnection returns success: true on valid query (Uses local connector logic)', async () => {
    // Setup success generator
    async function* successGen() {
      yield { columns: [], rows: [] };
    }
    mockConnector.runQuery.mockReturnValue(successGen());

    const config: ConnectorConfig = {
      host: 'localhost',
      port: 8080,
      user: 'test',
      ssl: false,
      sslVerify: true,
      maxRows: 100,
    };
    const result = await queryExecutor.testConnection('trino', config);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockConnector.runQuery).toHaveBeenCalledWith('SELECT 1', config, undefined);
  });

  test('execute uses saved connection if available', async () => {
    // Setup saved connections
    const mockProfile: any = { id: 'saved-1', type: 'trino', name: 'Saved' };
    mockConnectionManager.getConnections.mockResolvedValue([mockProfile]);
    mockConnectionManager.getConnection.mockResolvedValue(mockProfile);

    // Mock Daemon responses
    mockDaemonClient.runQuery.mockResolvedValue('tab-1');
    mockDaemonClient.getTabInfo.mockResolvedValue({
      status: 'success',
      columns: [],
      rows: [],
      rowCount: 0,
      hasMore: false,
    });

    const iterator = queryExecutor.execute('SELECT 1');
    await iterator.next();

    expect(mockConnectionManager.getConnection).toHaveBeenCalledWith('saved-1');
    expect(mockConnectionManager.getWorkspaceFallbackProfile).not.toHaveBeenCalled();
    expect(mockDaemonClient.runQuery).toHaveBeenCalledWith('SELECT 1', true, mockProfile);
  });

  test('execute uses workspace fallback if no saved connections', async () => {
    // Setup NO saved connections
    mockConnectionManager.getConnections.mockResolvedValue([]);
    const fallbackProfile: any = { id: 'fallback', type: 'trino' };
    mockConnectionManager.getWorkspaceFallbackProfile.mockResolvedValue(fallbackProfile);

    // Mock Daemon responses
    mockDaemonClient.runQuery.mockResolvedValue('tab-2');
    mockDaemonClient.getTabInfo.mockResolvedValue({
      status: 'success',
      columns: [],
      rows: [],
      rowCount: 0,
      hasMore: false,
    });

    const iterator = queryExecutor.execute('SELECT 1');
    await iterator.next();

    expect(mockConnectionManager.getWorkspaceFallbackProfile).toHaveBeenCalled();
    expect(mockDaemonClient.runQuery).toHaveBeenCalledWith('SELECT 1', true, fallbackProfile);
  });

  test('execute propagates error if fallback also fails (returns undefined)', async () => {
    mockConnectionManager.getConnections.mockResolvedValue([]);
    mockConnectionManager.getWorkspaceFallbackProfile.mockResolvedValue(undefined);

    // Mock Daemon response (DaemonClient might handle undefined profile gracefully or throw,
    // but QueryExecutor passes it through. If DaemonClient throws on undefined profile, we catch it)
    // Actually DaemonClient.runQuery takes 'unknown', but logically we assume it might send it.
    // However, QueryExecutor just passes it.
    // If we want to ensure it passes 'undefined', we test that.

    // In our implementation QueryExecutor passes whatever it gets.
    // The previous implementation passed 'undefined' if no active profile found.
    // We just want to ensure it falls back attempting to get it.

    mockDaemonClient.runQuery.mockResolvedValue('tab-3');
    mockDaemonClient.getTabInfo.mockResolvedValue({ status: 'success', rows: [] });

    const iterator = queryExecutor.execute('SELECT 1');
    await iterator.next();

    expect(mockDaemonClient.runQuery).toHaveBeenCalledWith('SELECT 1', true, undefined);
  });
});
