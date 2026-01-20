import { QueryExecutor } from '../../core/execution/QueryExecutor';
import { ConnectorRegistry } from '../../connectors/base/ConnectorRegistry';
import { ConnectionManager } from '../../services/ConnectionManager';
import { ConnectorConfig } from '../../connectors/base/IConnector';

// Mock dependencies
jest.mock('../../connectors/base/ConnectorRegistry');
jest.mock('../../services/ConnectionManager');

describe('QueryExecutor Unit Tests', () => {
  let queryExecutor: QueryExecutor;
  let mockRegistry: jest.Mocked<ConnectorRegistry>;
  let mockConnectionManager: jest.Mocked<ConnectionManager>;
  let mockConnector: any;

  beforeEach(() => {
    // Reset mocks
    (ConnectorRegistry as any).mockClear();
    (ConnectionManager as any).mockClear();

    // Create mock instances
    mockRegistry = new ConnectorRegistry() as jest.Mocked<ConnectorRegistry>;
    mockConnectionManager = new ConnectionManager({} as any) as jest.Mocked<ConnectionManager>;

    // Setup Connector Mock
    mockConnector = {
      runQuery: jest.fn(),
      validateConfig: jest.fn().mockReturnValue(undefined), // Valid by default
      id: 'trino',
    };
    mockRegistry.get = jest.fn().mockReturnValue(mockConnector);

    queryExecutor = new QueryExecutor(mockRegistry, mockConnectionManager);
  });

  test('testConnection returns success: true on valid query', async () => {
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

  test('testConnection returns success: false on error', async () => {
    // Setup failure generator
    // Mock iterator that throws immediately
    const mockIterator = {
      next: jest.fn().mockRejectedValue(new Error('Network Error')),
      [Symbol.asyncIterator]: function () {
        return this;
      },
    };
    mockConnector.runQuery.mockReturnValue(mockIterator);

    const config: ConnectorConfig = {
      host: 'localhost',
      port: 8080,
      user: 'test',
      ssl: false,
      sslVerify: true,
      maxRows: 100,
    };
    const result = await queryExecutor.testConnection('trino', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network Error');
  });
});
