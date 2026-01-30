import { DaemonQueryExecutor } from '../../server/DaemonQueryExecutor';
import { ConnectorRegistry } from '../../connectors/base/ConnectorRegistry';
import { FileConnectionManager } from '../../server/FileConnectionManager';
import { IConnector } from '../../connectors/base/IConnector';
import { TrinoConnectionProfile, QueryPage } from '../../common/types';

// Mock FileConnectionManager
jest.mock('../../server/FileConnectionManager');

describe('DaemonQueryExecutor', () => {
  let executor: DaemonQueryExecutor;
  let connectorRegistry: ConnectorRegistry;
  let fileConnectionManager: jest.Mocked<FileConnectionManager>;
  let mockConnector: jest.Mocked<IConnector>;

  beforeEach(() => {
    // Setup mocks
    connectorRegistry = new ConnectorRegistry();

    fileConnectionManager = new FileConnectionManager() as jest.Mocked<FileConnectionManager>;

    mockConnector = {
      id: 'trino',
      validateConfig: jest.fn(),
      runQuery: jest.fn(),
      supportsPagination: true,
      testConnection: jest.fn(),
    };

    connectorRegistry.register(mockConnector);

    executor = new DaemonQueryExecutor(connectorRegistry, fileConnectionManager);
  });

  const mockProfile: TrinoConnectionProfile = {
    id: 'conn1',
    name: 'Test',
    type: 'trino',
    host: 'localhost',
    port: 8080,
    user: 'admin',
    ssl: false,
  };

  it('should execute query successfully using connection override', async () => {
    mockConnector.runQuery.mockImplementation(async function* () {
      yield { data: [['result']], columns: [] } as QueryPage;
    });

    const iterator = executor.execute('SELECT 1', 'session1', undefined, undefined, mockProfile);

    const result = await iterator.next();
    expect(result.done).toBe(false);
    if (!result.done) {
      expect((result.value as QueryPage).data).toEqual([['result']]);
    }
    expect(mockConnector.validateConfig).toHaveBeenCalled();
  });

  it('should execute query successfully using stored connection', async () => {
    fileConnectionManager.getConnection.mockResolvedValue(mockProfile);

    mockConnector.runQuery.mockImplementation(async function* () {
      yield { data: [['result']], columns: [] } as QueryPage;
    });

    const iterator = executor.execute('SELECT 1', 'session1', 'conn1');

    const result = await iterator.next();
    expect(result.done).toBe(false);
    expect(fileConnectionManager.getConnection).toHaveBeenCalledWith('conn1');
  });

  it('should throw error if connector not registered', async () => {
    const invalidProfile = { ...mockProfile, type: 'unknown' as any };
    fileConnectionManager.getConnection.mockResolvedValue(invalidProfile);

    const iterator = executor.execute('SELECT 1', 'session1', 'conn1');

    await expect(iterator.next()).rejects.toThrow("Connector 'unknown' not registered");
  });

  it('should throw error if validation fails', async () => {
    mockConnector.validateConfig.mockReturnValue('Validation Error');
    fileConnectionManager.getConnection.mockResolvedValue(mockProfile);

    const iterator = executor.execute('SELECT 1', 'session1', 'conn1');

    await expect(iterator.next()).rejects.toThrow('Configuration Error: Validation Error');
  });

  it('should throw error if connection profile not found', async () => {
    // fileConnectionManager.getConnection returns undefined by default mock if not set
    fileConnectionManager.getConnection.mockResolvedValue(undefined);
    // also getConnections empty for fallback
    fileConnectionManager.getConnections.mockResolvedValue([]);

    const iterator = executor.execute('SELECT 1', 'session1', 'conn1');

    await expect(iterator.next()).rejects.toThrow('No valid connection profile found.');
  });

  it('should test connection successfully', async () => {
    mockConnector.runQuery.mockImplementation(async function* () {
      yield { data: [], columns: [] } as QueryPage;
    });

    const result = await executor.testConnection('trino', {});

    expect(result.success).toBe(true);
  });

  it('should return error on validation failure during test connection', async () => {
    mockConnector.validateConfig.mockReturnValue('Config Error');

    const result = await executor.testConnection('trino', {});

    expect(result.success).toBe(false);
    expect(result.error).toBe('Config Error');
  });

  it('should return error on query failure during test connection', async () => {
    mockConnector.runQuery.mockImplementation(async function* () {
      if (Math.random() > 2) {
        yield {} as QueryPage;
      }
      throw new Error('Connection Failed');
    });

    const result = await executor.testConnection('trino', {});

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection Failed');
  });
});
