/**
 * Unit tests for PostgreSQLConnector.
 *
 * The 'pg' module is mocked — no real Postgres instance is needed.
 * Run with: npm test
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();
const MockClient = jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
}));

jest.mock('pg', () => ({ Client: MockClient }), { virtual: true });

// The connector uses require(driverPath) where driverPath comes from driverManager.
// We mock driverManager so getDriver() returns 'pg', and jest intercepts that require.
import PostgreSQLConnector from '../index';

const mockDriverManager = {
    getDriver: jest.fn().mockResolvedValue('pg'),
};

// Helper: collect all pages from the generator
async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
    const pages: any[] = [];
    for await (const p of gen) pages.push(p);
    return pages;
}

// Helper: build a pg QueryResult-like object
function makeResult(fields: { name: string; dataTypeID: number }[], rows: Record<string, any>[]) {
    return { fields, rows, rowCount: rows.length };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
});

describe('PostgreSQLConnector', () => {
    let connector: PostgreSQLConnector;

    beforeEach(() => {
        connector = new PostgreSQLConnector(mockDriverManager);
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('validateConfig', () => {
        it('returns undefined when all required fields are present', () => {
            expect(
                connector.validateConfig({ host: 'localhost', port: 5432, user: 'u', database: 'db' } as any),
            ).toBeUndefined();
        });

        it('returns error when host is missing', () => {
            expect(connector.validateConfig({ port: 5432, user: 'u', database: 'db' } as any)).toBe(
                'Host is required',
            );
        });

        it('returns error when port is missing', () => {
            expect(connector.validateConfig({ host: 'localhost', user: 'u', database: 'db' } as any)).toBe(
                'Port is required',
            );
        });

        it('returns error when user is missing', () => {
            expect(
                connector.validateConfig({ host: 'localhost', port: 5432, database: 'db' } as any),
            ).toBe('User is required');
        });

        it('returns error when database is missing', () => {
            expect(connector.validateConfig({ host: 'localhost', port: 5432, user: 'u' } as any)).toBe(
                'Database is required',
            );
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('runQuery', () => {
        const baseConfig = { host: 'localhost', port: 5432, user: 'u', database: 'db' } as any;

        it('yields a QueryPage with columns and data on success', async () => {
            mockQuery.mockResolvedValueOnce(
                makeResult(
                    [
                        { name: 'id', dataTypeID: 23 },
                        { name: 'name', dataTypeID: 25 },
                    ],
                    [{ id: 1, name: 'Alice' }],
                ),
            );

            const pages = await collect(connector.runQuery('SELECT 1', baseConfig));
            expect(pages).toHaveLength(1);
            expect(pages[0].columns).toEqual([
                { name: 'id', type: 'integer' },
                { name: 'name', type: 'string' },
            ]);
            expect(pages[0].data).toEqual([[1, 'Alice']]);
            expect(pages[0].stats.rowCount).toBe(1);
        });

        it('yields page with empty data array on zero-row result', async () => {
            mockQuery.mockResolvedValueOnce(
                makeResult([{ name: 'id', dataTypeID: 23 }], []),
            );

            const pages = await collect(connector.runQuery('SELECT 1 WHERE false', baseConfig));
            expect(pages).toHaveLength(1);
            expect(pages[0].data).toEqual([]);
            expect(pages[0].stats.rowCount).toBe(0);
        });

        it('throws AuthenticationError for pg class-28 error code', async () => {
            const err = Object.assign(new Error('password auth failed'), { code: '28P01' });
            mockQuery.mockRejectedValueOnce(err);

            await expect(collect(connector.runQuery('SELECT 1', baseConfig))).rejects.toThrow(
                'Authentication failed',
            );
        });

        it('throws ConnectionError for pg class-08 error code', async () => {
            const err = Object.assign(new Error('connection refused'), { code: '08006' });
            mockQuery.mockRejectedValueOnce(err);

            await expect(collect(connector.runQuery('SELECT 1', baseConfig))).rejects.toThrow(
                'Connection failed',
            );
        });

        it('throws AuthenticationError via message fallback (no code)', async () => {
            mockQuery.mockRejectedValueOnce(new Error('password authentication failed'));

            await expect(collect(connector.runQuery('SELECT 1', baseConfig))).rejects.toThrow(
                'password authentication failed',
            );
        });

        it('throws ConnectionError via message fallback (ECONNREFUSED)', async () => {
            mockQuery.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

            await expect(collect(connector.runQuery('SELECT 1', baseConfig))).rejects.toThrow(
                'ECONNREFUSED',
            );
        });

        it('throws QueryError for generic unknown errors', async () => {
            // Use a message that doesn't match any keyword fallback ('password', 'auth', 'ECONNREFUSED', 'does not exist')
            mockQuery.mockRejectedValueOnce(new Error('invalid input syntax for type integer: "abc"'));

            await expect(collect(connector.runQuery('SELECT * FROM foo', baseConfig))).rejects.toThrow(
                'Query failed',
            );
        });



        it('calls client.end() even when query throws', async () => {
            mockQuery.mockRejectedValueOnce(new Error('oops'));

            await collect(connector.runQuery('SELECT 1', baseConfig)).catch(() => { });
            expect(mockEnd).toHaveBeenCalledTimes(1);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('type mapping via runQuery', () => {
        const baseConfig = { host: 'localhost', port: 5432, user: 'u', database: 'db' } as any;

        const cases: [string, number, string][] = [
            ['int8/20', 20, 'integer'],
            ['int2/21', 21, 'integer'],
            ['int4/23', 23, 'integer'],
            ['float4/700', 700, 'number'],
            ['float8/701', 701, 'number'],
            ['numeric/1700', 1700, 'number'],
            ['bool/16', 16, 'boolean'],
            ['timestamp/1114', 1114, 'timestamp'],
            ['timestamptz/1184', 1184, 'timestamp'],
            ['date/1082', 1082, 'date'],
            ['unknown/999', 999, 'string'],
        ];

        test.each(cases)('pg oid %s → SQL Preview "%s"', async (_label, oid, expectedType) => {
            mockQuery.mockResolvedValueOnce(
                makeResult([{ name: 'col', dataTypeID: oid }], [{ col: 'x' }]),
            );
            const pages = await collect(connector.runQuery('SELECT col', baseConfig));
            expect(pages[0].columns[0].type).toBe(expectedType);
        });
    });
});
