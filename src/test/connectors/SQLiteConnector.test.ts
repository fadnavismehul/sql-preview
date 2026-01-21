import { SQLiteConnector } from '../../connectors/sqlite/SQLiteConnector';

// Mock sqlite3
const mockDatabase = {
  once: jest.fn(),
  get: jest.fn(),
  each: jest.fn(),
  close: jest.fn(),
};

jest.mock('sqlite3', () => {
  return {
    Database: jest.fn().mockImplementation(() => mockDatabase),
  };
});

describe('SQLiteConnector', () => {
  let connector: SQLiteConnector;
  const config = {
    databasePath: '/tmp/test.db',
  };

  beforeEach(() => {
    connector = new SQLiteConnector();
    jest.clearAllMocks();

    // Default behavior: Connection success
    mockDatabase.once.mockImplementation((event, cb) => {
      if (event === 'open') {
        setTimeout(cb, 0);
      }
    });
    mockDatabase.get.mockImplementation((sql, cb) => {
      if (sql === 'PRAGMA user_version') {
        cb(null);
      }
    });
  });

  it('should validate configuration', () => {
    expect(connector.validateConfig({ databasePath: 'path' })).toBeUndefined();
    expect(connector.validateConfig({ databasePath: '' })).toBeDefined();
  });

  it('should connect and run query', async () => {
    // Setup query results
    mockDatabase.each.mockImplementation((_sql, rowCb, completeCb) => {
      // Simulate 2 rows
      rowCb(null, { id: 1, name: 'Test' });
      rowCb(null, { id: 2, name: 'Test2' });
      completeCb(null, 2);
    });

    const iterator = connector.runQuery('SELECT * FROM users', config);
    const result = await iterator.next();

    expect(result.value).toBeDefined();
    if (!result.value) {
      return;
    }
    expect(result.value.data).toHaveLength(2);
    expect(result.value.columns).toBeDefined();
    if (result.value.columns) {
      expect(result.value.columns).toHaveLength(2);
      const firstCol = result.value.columns[0];
      expect(firstCol).toBeDefined();
      expect(firstCol?.name).toBe('id');
    }
    await iterator.return(undefined);
    expect(mockDatabase.close).toHaveBeenCalled();
  });

  it('should handle connection error', async () => {
    // Simulate error on check
    mockDatabase.get.mockImplementation((_sql, cb) => {
      cb(new Error('Connection failed'));
    });

    const iterator = connector.runQuery('SELECT 1', config);
    await expect(iterator.next()).rejects.toThrow('Connection failed');
  });

  it('should handle query error', async () => {
    mockDatabase.each.mockImplementation((_sql, _rowCb, completeCb) => {
      completeCb(new Error('SQL Error'));
    });

    const iterator = connector.runQuery('BAD QUERY', config);
    await expect(iterator.next()).rejects.toThrow('SQL Error');
    expect(mockDatabase.close).toHaveBeenCalled();
  });
});
