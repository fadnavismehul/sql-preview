import { DaemonQueryExecutor } from '../../server/DaemonQueryExecutor';
import { ILogger } from '../../common/logger';
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
  const mockLogger: ILogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

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

    executor = new DaemonQueryExecutor(connectorRegistry, fileConnectionManager, mockLogger);
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

  it('should construct Basic Auth header when password is present', async () => {
    const profileWithAuth = { ...mockProfile, password: 'password123' };
    fileConnectionManager.getConnection.mockResolvedValue(profileWithAuth);

    // Mock runQuery to capture authHeader
    mockConnector.runQuery.mockImplementation(async function* (_query, _config, authHeader) {
      yield { data: [[authHeader]], columns: [] } as any;
    });

    const iterator = executor.execute('SELECT 1', 'session1', 'conn1');
    const result = await iterator.next();

    expect(result.done).toBe(false);
    const authHeader = (result.value as any).data[0][0];
    expect(authHeader).toBe('Basic ' + Buffer.from('admin:password123').toString('base64'));
  });

  it('should fallback to first connection if no connectionId provided', async () => {
    fileConnectionManager.getConnections.mockResolvedValue([mockProfile]);
    fileConnectionManager.getConnection.mockResolvedValue(mockProfile);

    // Explicitly return undefined for the first call (which would be by ID if provided)
    // But wait, the code checks 'connectionId' arg first. If undefined, it goes to else.
    // So we don't need to mock getConnection with arguments.

    mockConnector.runQuery.mockImplementation(async function* () {
      yield { data: [], columns: [] } as QueryPage;
    });

    const iterator = executor.execute('SELECT 1', 'session1'); // No connectionId
    await iterator.next();

    expect(fileConnectionManager.getConnections).toHaveBeenCalled();
    expect(fileConnectionManager.getConnection).toHaveBeenCalledWith(mockProfile.id);
  });

  it('should yield multiple pages from connector', async () => {
    mockConnector.runQuery.mockImplementation(async function* () {
      yield { data: [['page1']], columns: [] } as QueryPage;
      yield { data: [['page2']], columns: [] } as QueryPage;
    });

    fileConnectionManager.getConnection.mockResolvedValue(mockProfile);

    const iterator = executor.execute('SELECT 1', 'session1', 'conn1');

    const first = await iterator.next();
    expect((first.value as QueryPage).data).toEqual([['page1']]);

    const second = await iterator.next();
    expect((second.value as QueryPage).data).toEqual([['page2']]);

    const third = await iterator.next();
    expect(third.done).toBe(true);
  });
});
