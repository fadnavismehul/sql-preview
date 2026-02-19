import { QueryExecutor } from '../../../../core/execution/QueryExecutor';
import { ConnectionManager } from '../../../../services/ConnectionManager';
import { DriverManager } from '../../../../services/DriverManager';
import { DaemonClient } from '../../../../services/DaemonClient';
import { ConnectorRegistry } from '../../../../connectors/base/ConnectorRegistry';
import { SQLiteConnectionProfile } from '../../../../common/types';

// Mock dependencies
jest.mock('../../../../services/ConnectionManager');
jest.mock('../../../../services/DriverManager');
jest.mock('../../../../services/DaemonClient');

describe('QueryExecutor (Dynamic Loading Regression)', () => {
  let queryExecutor: QueryExecutor;
  let mockConnectorRegistry: ConnectorRegistry;
  let mockConnectionManager: jest.Mocked<ConnectionManager>;
  let mockDaemonClient: jest.Mocked<DaemonClient>;
  let mockDriverManager: jest.Mocked<DriverManager>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    mockConnectorRegistry = new ConnectorRegistry();
    mockConnectionManager = new ConnectionManager(
      {} as any,
      {} as any
    ) as jest.Mocked<ConnectionManager>;
    mockDaemonClient = new DaemonClient({} as any) as jest.Mocked<DaemonClient>;
    mockDriverManager = new DriverManager({} as any) as jest.Mocked<DriverManager>;

    // Setup default mocks
    mockDaemonClient.runQuery.mockResolvedValue('tab-123');
    mockDaemonClient.getTabInfo.mockResolvedValue({
      id: 'tab-123',
      status: 'success',
      rows: [],
      columns: [],
    } as any);

    queryExecutor = new QueryExecutor(
      mockConnectorRegistry,
      mockConnectionManager,
      mockDaemonClient,
      mockDriverManager
    );
  });

  it('should inject driver path for SQLite connections', async () => {
    const sqliteProfile: SQLiteConnectionProfile = {
      id: 'test-sqlite',
      name: 'Test SQLite',
      type: 'sqlite',
      databasePath: '/tmp/test.db',
    };

    mockConnectionManager.getConnections.mockResolvedValue([sqliteProfile]);
    mockConnectionManager.getConnection.mockResolvedValue(sqliteProfile);

    // Mock Driver Manager to return a specific path
    const expectedPath = '/mock/path/to/sqlite3';
    mockDriverManager.getDriver.mockResolvedValue(expectedPath);

    // Run execution (we just need to trigger the initial logic)
    const generator = queryExecutor.execute('SELECT 1');
    await generator.next();

    // Verify getDriver was called
    expect(mockDriverManager.getDriver).toHaveBeenCalledWith('sqlite3');

    // Verify runQuery was called with the injected driverPath
    expect(mockDaemonClient.runQuery).toHaveBeenCalled();
    const passedProfile = mockDaemonClient.runQuery.mock.calls[0]
      ? (mockDaemonClient.runQuery.mock.calls[0][2] as any)
      : undefined;

    expect(passedProfile).toBeDefined();
    expect(passedProfile.driverPath).toBe(expectedPath);
  });

  it('should NOT inject driver path for Trino connections', async () => {
    const trinoProfile: any = {
      id: 'test-trino',
      name: 'Test Trino',
      type: 'trino',
      host: 'localhost',
      port: 8080,
      user: 'admin',
    };

    mockConnectionManager.getConnections.mockResolvedValue([trinoProfile]);
    mockConnectionManager.getConnection.mockResolvedValue(trinoProfile);

    const generator = queryExecutor.execute('SELECT 1');
    await generator.next();

    // Verify getDriver was NOT called
    expect(mockDriverManager.getDriver).not.toHaveBeenCalled();

    // Verify driverPath is undefined
    expect(mockDaemonClient.runQuery).toHaveBeenCalled();
    const passedProfile = mockDaemonClient.runQuery.mock.calls[0]
      ? (mockDaemonClient.runQuery.mock.calls[0][2] as any)
      : undefined;
    expect(passedProfile.driverPath).toBeUndefined();
  });
});
