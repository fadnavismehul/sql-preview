/**
 * Unit tests for DuckDbConnector.
 *
 * @duckdb/node-api is mocked — no real DuckDB native module needed.
 * Run with: npm test
 */

// ── Mock @duckdb/node-api ────────────────────────────────────────────────────
const mockGetRows = jest.fn();
const mockColumnNames = jest.fn();
const mockColumnTypes = jest.fn();
const mockRun = jest.fn().mockResolvedValue({
    getRows: mockGetRows,
    columnNames: mockColumnNames,
    columnTypes: mockColumnTypes,
});
const mockConnect = jest.fn().mockResolvedValue({ run: mockRun });
const MockDuckDBInstance = {
    create: jest.fn().mockResolvedValue({ connect: mockConnect }),
};

jest.mock('@duckdb/node-api', () => ({ DuckDBInstance: MockDuckDBInstance }), { virtual: true });

import DuckDbConnector from '../index';

const mockDriverManager = { getDriver: jest.fn().mockResolvedValue('@duckdb/node-api') };

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
    const pages: any[] = [];
    for await (const p of gen) pages.push(p);
    return pages;
}

const baseConfig = {} as any; // DuckDB: optional databasePath, defaults to ':memory:'

beforeEach(() => {
    jest.clearAllMocks();
    MockDuckDBInstance.create.mockResolvedValue({ connect: mockConnect });
    mockConnect.mockResolvedValue({ run: mockRun });
    mockRun.mockResolvedValue({
        getRows: mockGetRows,
        columnNames: mockColumnNames,
        columnTypes: mockColumnTypes,
    });
});

describe('DuckDbConnector', () => {
    let connector: DuckDbConnector;

    beforeEach(() => {
        connector = new DuckDbConnector(mockDriverManager);
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('validateConfig', () => {
        it('always returns undefined (no required fields for DuckDB)', () => {
            expect(connector.validateConfig()).toBeUndefined();
        });
    });


    // ──────────────────────────────────────────────────────────────────────────
    describe('runQuery', () => {
        it('yields a QueryPage with columns and data on success', async () => {
            mockGetRows.mockResolvedValue([[1, 'Alice'], [2, 'Bob']]);
            mockColumnNames.mockReturnValue(['id', 'name']);
            mockColumnTypes.mockReturnValue(['INTEGER', 'VARCHAR']);

            const pages = await collect(connector.runQuery('SELECT 1', baseConfig));
            expect(pages.length).toBeGreaterThan(0);
            expect(pages[0].columns).toEqual([
                { name: 'id', type: 'number' },
                { name: 'name', type: 'string' },
            ]);
            expect(pages[0].data[0]).toEqual([1, 'Alice']);
        });

        it('yields page with empty data for zero-row result', async () => {
            mockGetRows.mockResolvedValue([]);

            const pages = await collect(connector.runQuery('SELECT 1 WHERE false', baseConfig));
            expect(pages).toHaveLength(1);
            expect(pages[0].data).toEqual([]);
            expect(pages[0].columns).toEqual([]);
        });

        it('throws ConnectionError when DuckDBInstance.create fails', async () => {
            MockDuckDBInstance.create.mockRejectedValueOnce(new Error('cannot open file'));

            await expect(collect(connector.runQuery('SELECT 1', baseConfig))).rejects.toThrow(
                'Failed to create DuckDB instance',
            );
        });

        it('throws ConnectionError when db.connect() fails', async () => {
            mockConnect.mockRejectedValueOnce(new Error('connection error'));

            await expect(collect(connector.runQuery('SELECT 1', baseConfig))).rejects.toThrow(
                'Failed to connect to DuckDB',
            );
        });

        it('throws QueryError when query.run() fails', async () => {
            mockRun.mockRejectedValueOnce(new Error('syntax error'));

            await expect(collect(connector.runQuery('SELECTS 1', baseConfig))).rejects.toThrow(
                'DuckDB Query Failed',
            );
        });

        it('converts BigInt values to Number in output', async () => {
            mockGetRows.mockResolvedValue([[BigInt(42)]]);
            mockColumnNames.mockReturnValue(['n']);
            mockColumnTypes.mockReturnValue(['BIGINT']);

            const pages = await collect(connector.runQuery('SELECT 42::BIGINT as n', baseConfig));
            expect(typeof pages[0].data[0][0]).toBe('number');
            expect(pages[0].data[0][0]).toBe(42);
        });

        it('pages batches of 1000 rows correctly', async () => {
            // 1500 rows → 2 pages
            const rows = Array.from({ length: 1500 }, (_, i) => [i]);
            mockGetRows.mockResolvedValue(rows);
            mockColumnNames.mockReturnValue(['i']);
            mockColumnTypes.mockReturnValue(['INTEGER']);

            const pages = await collect(connector.runQuery('SELECT ...', baseConfig));
            expect(pages).toHaveLength(2);
            expect(pages[0].data).toHaveLength(1000);
            expect(pages[1].data).toHaveLength(500);
        });

        it('uses :memory: by default (no databasePath in config)', async () => {
            mockGetRows.mockResolvedValue([]);

            await collect(connector.runQuery('SELECT 1', {} as any));
            expect(MockDuckDBInstance.create).toHaveBeenCalledWith(':memory:');
        });

        it('returns early when abortSignal is already aborted', async () => {
            const signal = { aborted: true } as AbortSignal;
            mockGetRows.mockResolvedValue([[1]]);
            mockColumnNames.mockReturnValue(['n']);
            mockColumnTypes.mockReturnValue(['INTEGER']);

            const pages = await collect(connector.runQuery('SELECT 1', baseConfig, undefined, signal));
            // Should bail out before yielding the page
            expect(pages).toHaveLength(0);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('testConnection', () => {
        it('returns success:true when SELECT 1 works', async () => {
            mockGetRows.mockResolvedValue([[1]]);
            mockColumnNames.mockReturnValue(['1']);
            mockColumnTypes.mockReturnValue(['INTEGER']);

            const result = await connector.testConnection(baseConfig);
            expect(result.success).toBe(true);
        });

        it('returns success:false when query throws', async () => {
            MockDuckDBInstance.create.mockRejectedValueOnce(new Error('bad path'));

            const result = await connector.testConnection(baseConfig);
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('type mapping', () => {
        const cases: [string, string][] = [
            ['INTEGER', 'number'],
            ['BIGINT', 'number'],
            ['DOUBLE', 'number'],
            ['FLOAT', 'number'],
            ['DECIMAL', 'number'],
            ['SMALLINT', 'number'],
            ['TINYINT', 'number'],
            ['BOOLEAN', 'boolean'],
            ['VARCHAR', 'string'],
            ['TIMESTAMP', 'string'],
        ];

        test.each(cases)('DuckDB type %s → SQL Preview "%s"', async (duckType, expectedSqlType) => {
            mockGetRows.mockResolvedValue([['x']]);
            mockColumnNames.mockReturnValue(['col']);
            mockColumnTypes.mockReturnValue([duckType]);

            const pages = await collect(connector.runQuery('SELECT col', baseConfig));
            expect(pages[0].columns[0].type).toBe(expectedSqlType);
        });
    });
});
