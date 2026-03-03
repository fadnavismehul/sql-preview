/**
 * Unit tests for MSSQLConnector.
 *
 * The 'mssql' module is mocked — no real SQL Server instance needed.
 * Run with: npm test
 */

// ── Mock mssql ───────────────────────────────────────────────────────────────
const mockQuery = jest.fn();
const mockInput = jest.fn().mockReturnThis(); // chainable
const mockRequest = jest.fn().mockImplementation(() => ({
    input: mockInput,
    query: mockQuery,
}));
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockPool = {
    request: mockRequest,
    close: mockClose,
};
const mockConnect = jest.fn().mockResolvedValue(mockPool);

jest.mock('mssql', () => ({ connect: mockConnect }), { virtual: true });

import MSSQLConnector, { MSSQLConfig } from '../index';
import { AuthenticationError, ConnectionError, QueryError } from '@sql-preview/connector-api';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
    const pages: any[] = [];
    for await (const p of gen) pages.push(p);
    return pages;
}

function makeResult(
    columns: Record<string, { type: { declaration: string } }>,
    rows: Record<string, unknown>[],
) {
    const recordset: any = [...rows];
    recordset.columns = columns;
    return { recordset };
}

const BASE: MSSQLConfig = {
    host: 'localhost',
    port: 1433,
    user: 'sa',
    password: 'Password1!',
    database: 'master',
};

beforeEach(() => {
    jest.resetAllMocks(); // clears call history AND mockOnce queues
    mockClose.mockResolvedValue(undefined);
    mockInput.mockReturnThis();
    // Default: empty result — individual tests override with mockResolvedValueOnce
    mockQuery.mockResolvedValue(makeResult({}, []));
    mockRequest.mockImplementation(() => ({ input: mockInput, query: mockQuery }));
    mockConnect.mockResolvedValue(mockPool);
});


// ────────────────────────────────────────────────────────────────────────────
describe('MSSQLConnector', () => {
    let connector: MSSQLConnector;

    beforeEach(() => {
        connector = new MSSQLConnector();
    });

    // ── validateConfig ───────────────────────────────────────────────────────
    describe('validateConfig', () => {
        it('returns undefined when all required fields are present', () => {
            expect(connector.validateConfig(BASE)).toBeUndefined();
        });

        it('returns error when host is missing', () => {
            expect(connector.validateConfig({ ...BASE, host: '' })).toBe('host is required');
        });

        it('returns error when user is missing', () => {
            expect(connector.validateConfig({ ...BASE, user: '' })).toBe('user is required');
        });

        it('returns error when database is missing', () => {
            expect(connector.validateConfig({ ...BASE, database: '' })).toBe('database is required');
        });

        it('returns undefined when optional fields (port, ssl) are missing', () => {
            const { port, ssl, ...minimal } = BASE as any;
            expect(connector.validateConfig(minimal)).toBeUndefined();
        });
    });

    // ── runQuery — success ───────────────────────────────────────────────────
    describe('runQuery — success', () => {
        it('yields a QueryPage with columns and rows', async () => {
            mockQuery.mockResolvedValueOnce(
                makeResult(
                    {
                        id: { type: { declaration: 'INT' } },
                        name: { type: { declaration: 'NVARCHAR' } },
                    },
                    [
                        { id: 1, name: 'Alice' },
                        { id: 2, name: 'Bob' },
                    ],
                ),
            );

            const pages = await collect(connector.runQuery('SELECT id, name FROM t', BASE));
            expect(pages).toHaveLength(1);
            expect(pages[0].columns).toEqual([
                { name: 'id', type: 'integer' },
                { name: 'name', type: 'string' },
            ]);
            expect(pages[0].data).toEqual([
                [1, 'Alice'],
                [2, 'Bob'],
            ]);
            expect(pages[0].stats.rowCount).toBe(2);
        });

        it('yields page with empty data for zero-row result', async () => {
            mockQuery.mockResolvedValueOnce(makeResult({}, []));

            const pages = await collect(connector.runQuery('SELECT 1 WHERE 1=0', BASE));
            expect(pages).toHaveLength(1);
            expect(pages[0].data).toEqual([]);
            expect(pages[0].stats.rowCount).toBe(0);
        });

        it('builds columns from row keys when recordset.columns is absent', async () => {
            const recordset: any = [{ n: 42 }];
            // no .columns property
            mockQuery.mockResolvedValueOnce({ recordset });

            const pages = await collect(connector.runQuery('SELECT 42 AS n', BASE));
            expect(pages[0].columns).toEqual([{ name: 'n', type: 'string' }]);
            expect(pages[0].data).toEqual([[42]]);
        });

        it('closes the pool even on success', async () => {
            mockQuery.mockResolvedValueOnce(makeResult({}, []));
            await collect(connector.runQuery('SELECT 1', BASE));
            expect(mockClose).toHaveBeenCalledTimes(1);
        });
    });

    // ── type mapping ─────────────────────────────────────────────────────────
    describe('type mapping', () => {
        const cases: [string, string][] = [
            ['INT', 'integer'],
            ['BIGINT', 'integer'],
            ['SMALLINT', 'integer'],
            ['TINYINT', 'integer'],
            ['FLOAT', 'number'],
            ['REAL', 'number'],
            ['DECIMAL', 'number'],
            ['NUMERIC', 'number'],
            ['MONEY', 'number'],
            ['SMALLMONEY', 'number'],
            ['DATETIME', 'timestamp'],
            ['DATETIME2', 'timestamp'],
            ['SMALLDATETIME', 'timestamp'],
            ['DATETIMEOFFSET', 'timestamp'],
            ['DATE', 'date'],
            ['BIT', 'boolean'],
            ['NVARCHAR', 'string'],
            ['VARCHAR', 'string'],
            ['UNIQUEIDENTIFIER', 'string'],
            ['XML', 'string'],
        ];

        test.each(cases)('T-SQL %s → SQL Preview "%s"', async (declaration, expectedType) => {
            mockQuery.mockResolvedValueOnce(
                makeResult({ col: { type: { declaration } } }, [{ col: 'x' }]),
            );
            const pages = await collect(connector.runQuery('SELECT col', BASE));
            expect(pages[0].columns[0].type).toBe(expectedType);
        });
    });

    // ── error classification ─────────────────────────────────────────────────
    describe('error classification', () => {
        it('throws AuthenticationError for SQL Server error 18456 (login failed)', async () => {
            const err = Object.assign(new Error('Login failed for user "sa".'), { number: 18456 });
            mockConnect.mockRejectedValueOnce(err);

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                AuthenticationError,
            );
        });

        it('throws AuthenticationError via "Login failed" message fallback', async () => {
            mockConnect.mockRejectedValueOnce(new Error('Login failed for user sa'));

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                AuthenticationError,
            );
        });

        it('throws ConnectionError for ECONNREFUSED', async () => {
            const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
            mockConnect.mockRejectedValueOnce(err);

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                ConnectionError,
            );
        });

        it('throws ConnectionError for ETIMEOUT', async () => {
            const err = Object.assign(new Error('Connection timeout'), { code: 'ETIMEOUT' });
            mockConnect.mockRejectedValueOnce(err);

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                ConnectionError,
            );
        });

        it('throws ConnectionError for ENOTFOUND', async () => {
            const err = Object.assign(new Error('getaddrinfo ENOTFOUND badhost'), {
                code: 'ENOTFOUND',
            });
            mockConnect.mockRejectedValueOnce(err);

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                ConnectionError,
            );
        });

        it('throws ConnectionError with friendly SSL hint for self-signed cert error', async () => {
            mockConnect.mockRejectedValueOnce(
                new Error('self-signed certificate in certificate chain'),
            );

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                /trustServerCertificate/,
            );
        });

        it('throws QueryError from query-level errors (T-SQL syntax)', async () => {
            mockQuery.mockRejectedValueOnce(
                new Error("Incorrect syntax near 'SELECTS'"),
            );
            mockQuery.mockResolvedValueOnce(makeResult({}, [])); // connect succeeds

            await expect(collect(connector.runQuery('SELECTS 1', BASE))).rejects.toThrow(
                QueryError,
            );
        });

        it('closes the pool even when query throws', async () => {
            mockQuery.mockRejectedValueOnce(new Error('query error'));
            await collect(connector.runQuery('BAD SQL', BASE)).catch(() => { });
            expect(mockClose).toHaveBeenCalledTimes(1);
        });
    });

    // ── Azure SQL auto-detect ────────────────────────────────────────────────
    describe('Azure SQL auto-detect', () => {
        it('sets encrypt:true automatically for *.database.windows.net hosts', async () => {
            mockQuery.mockResolvedValueOnce(makeResult({}, []));
            const azureCfg: MSSQLConfig = {
                ...BASE,
                host: 'myserver.database.windows.net',
                ssl: undefined, // let auto-detect kick in
            };

            await collect(connector.runQuery('SELECT 1', azureCfg));
            const poolConfig = mockConnect.mock.calls[0][0];
            expect(poolConfig.options.encrypt).toBe(true);
        });

        it('uses explicit ssl:false even for Azure SQL host if caller sets it', async () => {
            mockQuery.mockResolvedValueOnce(makeResult({}, []));
            const azureCfg: MSSQLConfig = {
                ...BASE,
                host: 'myserver.database.windows.net',
                ssl: false,
            };

            await collect(connector.runQuery('SELECT 1', azureCfg));
            const poolConfig = mockConnect.mock.calls[0][0];
            // ssl: false overrides auto-detect via the ?? operator order
            expect(poolConfig.options.encrypt).toBe(false);
        });
    });

    // ── abort signal ─────────────────────────────────────────────────────────
    describe('abort signal', () => {
        it('returns early without yielding when signal is pre-aborted', async () => {
            const signal = { aborted: true } as AbortSignal;
            mockQuery.mockResolvedValueOnce(makeResult({}, [{ n: 1 }]));

            const pages = await collect(connector.runQuery('SELECT 1', BASE, undefined, signal));
            expect(pages).toHaveLength(0);
        });
    });

    // ── testConnection ───────────────────────────────────────────────────────
    describe('testConnection', () => {
        it('returns success:true when ping succeeds', async () => {
            mockQuery.mockResolvedValueOnce(makeResult({}, [{ n: 1 }]));

            const result = await connector.testConnection(BASE);
            expect(result.success).toBe(true);
        });

        it('returns success:false with error message on connection failure', async () => {
            mockConnect.mockRejectedValueOnce(new Error('Cannot connect to localhost'));

            const result = await connector.testConnection(BASE);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Cannot connect');
        });

        it('closes pool after successful connection test', async () => {
            mockQuery.mockResolvedValueOnce(makeResult({}, [{ n: 1 }]));
            await connector.testConnection(BASE);
            expect(mockClose).toHaveBeenCalledTimes(1);
        });
    });
});
