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

  test('execute delegates to DaemonClient', async () => {
    // Mock Daemon responses
    mockDaemonClient.runQuery.mockResolvedValue('tab-123');
    mockDaemonClient.getTabInfo
      .mockResolvedValueOnce({
        status: 'loading',
      })
      .mockResolvedValueOnce({
        status: 'success',
        columns: [{ name: 'col1', type: 'string' }],
        rows: [['val1']],
        rowCount: 1,
      });

    const iterator = queryExecutor.execute('SELECT * FROM foo');
    const result = await iterator.next(); // Should wait until success

    expect(mockDaemonClient.runQuery).toHaveBeenCalledWith('SELECT * FROM foo', true);
    expect(mockDaemonClient.getTabInfo).toHaveBeenCalledWith('tab-123');

    expect(result.value).toEqual({
      columns: [{ name: 'col1', type: 'string' }],
      data: [['val1']],
      stats: {
        state: 'FINISHED',
        rowCount: 1,
      },
    });
  });
});
