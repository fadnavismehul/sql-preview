import { SQLiteConnector, SQLiteConfig } from '../../../../connectors/sqlite/SQLiteConnector';
import * as fs from 'fs';
import initSqlJs from 'sql.js';

jest.mock('fs', () => {
  return {
    promises: {
      readFile: jest.fn(),
    },
  };
});

// We can actually use the real sql.js since it works in node and doesn't require native bindings.
// However, compiling WASM in every test run might be slow or unsupported in some test envs,
// so we'll mock sql.js to keep the unit test completely isolated and fast.
jest.mock('sql.js', () => {
  return jest.fn().mockImplementation(() => {
    return Promise.resolve({
      Database: jest.fn().mockImplementation(() => ({
        prepare: jest.fn(),
        close: jest.fn(),
      })),
    });
  });
});

describe('SQLiteConnector (WASM)', () => {
  let connector: SQLiteConnector;
  let mockReadFile: jest.Mock;
  let mockInitSqlJs: jest.Mock;
  let mockPrepare: jest.Mock;
  let mockClose: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    connector = new SQLiteConnector();
    mockReadFile = fs.promises.readFile as jest.Mock;
    mockInitSqlJs = initSqlJs as unknown as jest.Mock;

    mockPrepare = jest.fn();
    mockClose = jest.fn();
  });

  const setupMockDb = (steps: Array<{ step: boolean; get?: any[]; cols?: string[] }>) => {
    let stepIndex = -1;
    mockPrepare.mockReturnValue({
      step: jest.fn().mockImplementation(() => {
        stepIndex++;
        return stepIndex < steps.length ? steps[stepIndex]?.step : false;
      }),
      get: jest.fn().mockImplementation(() => steps[stepIndex]?.get),
      getColumnNames: jest.fn().mockImplementation(() => steps[stepIndex]?.cols || []),
      free: jest.fn(),
    });

    mockInitSqlJs.mockResolvedValue({
      Database: jest.fn().mockImplementation(() => ({
        prepare: mockPrepare,
        close: mockClose,
      })),
    });
  };

  it('should validate configuration requiring databasePath', () => {
    const error = connector.validateConfig({} as any);
    expect(error).toBe('Database path is required');
  });

  it('should read file, initialize sql.js, and execute query returning rows', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('fake-db-content'));

    setupMockDb([
      { step: true, get: [1, 'Alice'], cols: ['id', 'name'] },
      { step: true, get: [2, 'Bob'], cols: ['id', 'name'] },
      { step: false },
    ]);

    const config: SQLiteConfig = {
      host: 'localhost',
      port: 0,
      user: '',
      ssl: false,
      sslVerify: true,
      maxRows: 100,
      databasePath: '/some/path/test.db',
    };

    const iterator = connector.runQuery('SELECT * FROM users', config);
    const result = await iterator.next();

    expect(result.done).toBe(false);
    expect(result.value).toEqual({
      columns: [
        { name: 'id', type: 'unknown' },
        { name: 'name', type: 'unknown' },
      ],
      data: [
        [1, 'Alice'],
        [2, 'Bob'],
      ],
    });

    const finish = await iterator.next();
    expect(finish.done).toBe(true);

    expect(mockReadFile).toHaveBeenCalledWith('/some/path/test.db');
    expect(mockPrepare).toHaveBeenCalledWith('SELECT * FROM users');
    expect(mockClose).toHaveBeenCalled();
  });

  it('should yield empty array when no rows returned but table exists', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('fake-db-content'));
    // sql.js doesn't yield columns easily if step is false initially
    setupMockDb([{ step: false }]);

    const config: SQLiteConfig = {
      host: '',
      port: 0,
      user: '',
      ssl: false,
      sslVerify: true,
      maxRows: 100,
      databasePath: '/empty.db',
    };
    const iterator = connector.runQuery('SELECT * FROM empty_table', config);
    const result = await iterator.next();

    expect(result.done).toBe(false);
    expect(result.value).toEqual({
      columns: [],
      data: [],
    });
  });

  it('should propagate file reading errors', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const config: SQLiteConfig = {
      host: '',
      port: 0,
      user: '',
      ssl: false,
      sslVerify: true,
      maxRows: 100,
      databasePath: '/notfound.db',
    };

    const iterator = connector.runQuery('SELECT 1', config);
    await expect(iterator.next()).rejects.toThrow(
      'Failed to load SQLite file at /notfound.db: ENOENT'
    );
  });
});
