import MySQLConnector, { MySQLConfig } from '../index';
import { AuthenticationError, ConnectionError, QueryError } from '@sql-preview/connector-api';

// ────────────────────────────────────────────────────────────────────────────
// mysql2/promise mock
// ────────────────────────────────────────────────────────────────────────────
const mockPing = jest.fn();
const mockQuery = jest.fn();
const mockEnd = jest.fn().mockResolvedValue(undefined);
const mockCreateConnection = jest.fn();

jest.mock('mysql2/promise', () => ({
    createConnection: (...args: any[]) => mockCreateConnection(...args),
}));

const makeMockConnection = (overrides: Partial<{
    ping: jest.Mock;
    query: jest.Mock;
    end: jest.Mock;
}> = {}) => ({
    ping: overrides.ping ?? mockPing,
    query: overrides.query ?? mockQuery,
    end: overrides.end ?? mockEnd,
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const BASE_CONFIG: MySQLConfig = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'testdb',
};

/** Collect all pages from the async generator */
async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
    const pages: any[] = [];
    for await (const page of gen) pages.push(page);
    return pages;
}

/** Make fake mysql2 field descriptor */
const field = (name: string, type: number) => ({ name, type });

describe('MySQLConnector', () => {
    let connector: MySQLConnector;

    beforeEach(() => {
        connector = new MySQLConnector();
        jest.clearAllMocks();
        mockEnd.mockResolvedValue(undefined);
    });

    // ── validateConfig ─────────────────────────────────────────────────────────
    describe('validateConfig', () => {
        it('returns undefined when all required fields are present', () => {
            expect(connector.validateConfig(BASE_CONFIG)).toBeUndefined();
        });

        it('returns error when host is missing', () => {
            expect(connector.validateConfig({ ...BASE_CONFIG, host: '' })).toBe('host is required');
        });

        it('returns error when port is missing', () => {
            expect(connector.validateConfig({ ...BASE_CONFIG, port: 0 })).toBe('port is required');
        });

        it('returns error when user is missing', () => {
            expect(connector.validateConfig({ ...BASE_CONFIG, user: '' })).toBe('user is required');
        });

        it('returns error when database is missing', () => {
            expect(connector.validateConfig({ ...BASE_CONFIG, database: '' })).toBe('database is required');
        });
    });

    // ── runQuery ───────────────────────────────────────────────────────────────
    describe('runQuery', () => {
        it('yields a QueryPage with columns and rows on success', async () => {
            const fields = [field('id', 3 /* LONG */), field('name', 253 /* VAR_STRING */)];
            const rows = [[1, 'Alice'], [2, 'Bob']];
            mockQuery.mockResolvedValueOnce([rows, fields]);
            mockCreateConnection.mockResolvedValueOnce(makeMockConnection());

            const pages = await collect(connector.runQuery('SELECT id, name FROM users', BASE_CONFIG));

            expect(pages).toHaveLength(1);
            expect(pages[0].columns).toEqual([
                { name: 'id', type: 'integer' },
                { name: 'name', type: 'string' },
            ]);
            expect(pages[0].data).toEqual(rows);
            expect(pages[0].stats.rowCount).toBe(2);
            expect(pages[0].stats.state).toBe('FINISHED');
        });

        it('yields a page with empty data array on zero-row result', async () => {
            const fields = [field('count', 8 /* LONGLONG */)];
            mockQuery.mockResolvedValueOnce([[], fields]);
            mockCreateConnection.mockResolvedValueOnce(makeMockConnection());

            const pages = await collect(connector.runQuery('SELECT COUNT(*) AS count FROM empty', BASE_CONFIG));

            expect(pages).toHaveLength(1);
            expect(pages[0].data).toEqual([]);
            expect(pages[0].columns).toEqual([{ name: 'count', type: 'integer' }]);
        });

        it('throws AuthenticationError on ER_ACCESS_DENIED_ERROR', async () => {
            const err: any = new Error('Access denied for user');
            err.code = 'ER_ACCESS_DENIED_ERROR';
            mockCreateConnection.mockRejectedValueOnce(err);

            await expect(collect(connector.runQuery('SELECT 1', BASE_CONFIG))).rejects.toBeInstanceOf(AuthenticationError);
        });

        it('throws ConnectionError on ECONNREFUSED', async () => {
            const err: any = new Error('connect ECONNREFUSED 127.0.0.1:3306');
            err.code = 'ECONNREFUSED';
            mockCreateConnection.mockRejectedValueOnce(err);

            await expect(collect(connector.runQuery('SELECT 1', BASE_CONFIG))).rejects.toBeInstanceOf(ConnectionError);
        });

        it('throws ConnectionError on ETIMEDOUT', async () => {
            const err: any = new Error('connect ETIMEDOUT');
            err.code = 'ETIMEDOUT';
            mockCreateConnection.mockRejectedValueOnce(err);

            await expect(collect(connector.runQuery('SELECT 1', BASE_CONFIG))).rejects.toBeInstanceOf(ConnectionError);
        });

        it('throws QueryError on table-not-found error', async () => {
            const conn = makeMockConnection();
            mockCreateConnection.mockResolvedValueOnce(conn);
            const err: any = new Error("Table 'testdb.no_such' doesn't exist");
            err.code = 'ER_NO_SUCH_TABLE';
            conn.query.mockRejectedValueOnce(err);

            await expect(collect(connector.runQuery('SELECT * FROM no_such', BASE_CONFIG))).rejects.toBeInstanceOf(QueryError);
        });

        it('closes the connection even when query throws', async () => {
            const conn = makeMockConnection();
            mockCreateConnection.mockResolvedValueOnce(conn);
            conn.query.mockRejectedValueOnce(new Error('boom'));

            await expect(collect(connector.runQuery('BAD SQL', BASE_CONFIG))).rejects.toThrow();
            expect(conn.end).toHaveBeenCalledTimes(1);
        });
    });

    // ── testConnection ─────────────────────────────────────────────────────────
    describe('testConnection', () => {
        it('returns success:true when ping resolves', async () => {
            mockPing.mockResolvedValueOnce(undefined);
            mockCreateConnection.mockResolvedValueOnce(makeMockConnection());

            const result = await connector.testConnection(BASE_CONFIG);
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('returns success:false when connection fails', async () => {
            mockCreateConnection.mockRejectedValueOnce(new Error('ECONNREFUSED'));

            const result = await connector.testConnection(BASE_CONFIG);
            expect(result.success).toBe(false);
            expect(result.error).toContain('ECONNREFUSED');
        });
    });

    // ── listSchemas ────────────────────────────────────────────────────────────
    describe('listSchemas', () => {
        it('returns user schemas excluding system schemas', async () => {
            const systemAndUser = [
                ['information_schema'],
                ['mysql'],
                ['performance_schema'],
                ['sys'],
                ['myapp'],
                ['analytics'],
            ];
            mockCreateConnection.mockResolvedValue(makeMockConnection({
                query: jest.fn().mockResolvedValue([systemAndUser, []]),
            }));

            const schemas = await connector.listSchemas(BASE_CONFIG);

            expect(schemas.map(s => s.schema)).toEqual(['myapp', 'analytics']);
        });
    });

    // ── listTables ─────────────────────────────────────────────────────────────
    describe('listTables', () => {
        it('returns tables and views with correct type labels', async () => {
            const rows = [
                ['users', 'BASE TABLE', ''],
                ['orders', 'BASE TABLE', 'Order data'],
                ['v_summary', 'VIEW', ''],
            ];
            mockCreateConnection.mockResolvedValue(makeMockConnection({
                query: jest.fn().mockResolvedValue([rows, []]),
            }));

            const tables = await connector.listTables(BASE_CONFIG, 'myapp');

            expect(tables).toHaveLength(3);
            expect(tables[0]).toMatchObject({ name: 'users', type: 'TABLE', schema: 'myapp' });
            expect(tables[1]).toMatchObject({ name: 'orders', type: 'TABLE', comment: 'Order data' });
            expect(tables[2]).toMatchObject({ name: 'v_summary', type: 'VIEW' });
        });
    });

    // ── describeTable ──────────────────────────────────────────────────────────
    describe('describeTable', () => {
        it('returns column info with isPrimaryKey correctly set', async () => {
            const pkRows = [['id']]; // PK column
            const colRows = [
                ['id', 'int', 'NO', 1, null, ''],
                ['email', 'varchar', 'YES', 2, null, 'Email address'],
            ];

            const mockQueryImpl = jest.fn()
                .mockResolvedValueOnce([pkRows, []]) // KEY_COLUMN_USAGE query
                .mockResolvedValueOnce([colRows, []]); // COLUMNS query

            mockCreateConnection.mockResolvedValue(makeMockConnection({ query: mockQueryImpl }));

            const result = await connector.describeTable(BASE_CONFIG, 'users', 'myapp');

            expect(result.table).toMatchObject({ name: 'users', schema: 'myapp' });
            expect(result.columns).toHaveLength(2);
            expect(result.columns[0]).toMatchObject({ name: 'id', isPrimaryKey: true, nullable: false });
            expect(result.columns[1]).toMatchObject({ name: 'email', isPrimaryKey: false, nullable: true, comment: 'Email address' });
        });
    });

    // ── type mapping ───────────────────────────────────────────────────────────
    describe('type mapping via runQuery', () => {
        const typeTestCases: [string, number, string][] = [
            ['TINY/1', 1, 'integer'],
            ['SHORT/2', 2, 'integer'],
            ['LONG/3', 3, 'integer'],
            ['FLOAT/4', 4, 'number'],
            ['DOUBLE/5', 5, 'number'],
            ['TIMESTAMP/7', 7, 'timestamp'],
            ['LONGLONG/8', 8, 'integer'],
            ['DATE/10', 10, 'date'],
            ['DATETIME/12', 12, 'timestamp'],
            ['BIT/16', 16, 'boolean'],
            ['NEWDECIMAL/246', 246, 'number'],
            ['VARCHAR/253', 253, 'string'],
            ['STRING/254', 254, 'string'],
        ];

        test.each(typeTestCases)('mysql2 type %s → SQL Preview "%s"', async (_, typeId, expectedType) => {
            mockCreateConnection.mockResolvedValueOnce(makeMockConnection({
                query: jest.fn().mockResolvedValue([[[42]], [field('col', typeId)]]),
            }));

            const pages = await collect(connector.runQuery('SELECT col FROM t', BASE_CONFIG));
            expect(pages[0].columns[0].type).toBe(expectedType);
        });
    });
});
