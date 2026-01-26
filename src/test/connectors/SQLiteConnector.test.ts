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

  it('should maintain consistent columns across batches', async () => {
    // Simulate async delivery to force multiple batches
    mockDatabase.each.mockImplementation((_sql, rowCb, completeCb) => {
      // Batch 1
      rowCb(null, { id: 1, val: 'text' });

      // Simulate delay for Batch 2 (we can't really settimeout inside sync mock easily to affect the generator loop without complex setup)
      // Instead, we just rely on the fact that if we push one, force a yield, then push another...
      // But db.each is fired once.

      // We'll mimic this by using a helper that the test controls?
      // Diffcult with current mock structure.
      // Let's just push two rows synchronously but assume the implementation *could* split them if we controlled queue consumption.
      // Actually, since the implementation grabs all available in queue, sync push means 1 batch.

      // To force split: we need the generator to wake up and consume queue while db.each is "paused".
      // But db.each is a function call. It returns.
      // If db.each is async in valid sqlite3, it just returns and callbacks fire later.

      // Let's implement mock to fire second callback asynchronously
      setTimeout(() => {
        rowCb(null, { id: 2, val: null });
        completeCb(null, 2);
      }, 10);
    });

    const iterator = connector.runQuery('SELECT *', config);

    // First batch (immediate)
    const result1 = await iterator.next();
    expect(result1.value).toBeDefined();
    // In current mock logic (sync first row), we get first row
    expect(result1.value?.columns).toBeDefined();
    if (result1.value?.columns && result1.value.columns[1]) {
      expect(result1.value.columns[1].type).toBe('string');
    }

    // Second batch (after timeout)
    const result2 = await iterator.next();
    expect(result2.value).toBeDefined();

    // THIS IS THE BUG: The second batch re-infers columns from {id:2, val:null}
    // typeof null is 'object'.
    // So if the bug exists, type will be 'object'.
    // If fixed, it should either be undefined (not sent) or consistent.
    if (result2.value?.columns) {
      // Asserting the behavior we want to avoid (or fix)
      // For reproduction, we expect this might be 'object' if bug exists
      // But we want to Assert it IS string (consistent) or undefined.
      // Let's assert it is 'string' which will fail if bug exists.
      // Actually, for reproduction, I'll log it or expect 'object' to confirm bug?
      // No, I should write the test enforcing CORRECT behavior.
      // If it fails, I have a repro.

      // However, if result2.value.columns is undefined, that's also valid (no update).
      if (result2.value.columns[1]) {
        expect(result2.value.columns[1].type).toBe('string');
      }
    }
  });
});
