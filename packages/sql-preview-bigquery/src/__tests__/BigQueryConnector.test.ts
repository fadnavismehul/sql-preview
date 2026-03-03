/**
 * Unit tests for BigQueryConnector.
 *
 * '@google-cloud/bigquery' is fully mocked — no GCP account needed.
 * Run with: npm test
 */

// ── Mock @google-cloud/bigquery ──────────────────────────────────────────────
const mockQuery = jest.fn();
const mockGetDatasets = jest.fn();
const mockGetTables = jest.fn();
const mockGetMetadata = jest.fn();

const mockTable = jest.fn().mockReturnValue({ getMetadata: mockGetMetadata });
const mockDatasetFn = jest.fn().mockReturnValue({
    getTables: mockGetTables,
    table: mockTable,
});

const MockBigQuery = jest.fn().mockImplementation(() => ({
    query: mockQuery,
    getDatasets: mockGetDatasets,
    dataset: mockDatasetFn,
}));

jest.mock('@google-cloud/bigquery', () => ({ BigQuery: MockBigQuery }), { virtual: true });

import BigQueryConnector, { BigQueryConfig } from '../index';
import { AuthenticationError, ConnectionError, QueryError } from '@sql-preview/connector-api';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
    const pages: any[] = [];
    for await (const p of gen) pages.push(p);
    return pages;
}

const BASE: BigQueryConfig = {
    projectId: 'my-project',
    location: 'US',
};

beforeEach(() => {
    jest.resetAllMocks();
    // Re-setup MockBigQuery since resetAllMocks clears all mock implementations
    MockBigQuery.mockImplementation(() => ({
        query: mockQuery,
        getDatasets: mockGetDatasets,
        dataset: mockDatasetFn,
    }));
    mockDatasetFn.mockReturnValue({
        getTables: mockGetTables,
        table: mockTable,
    });
    mockTable.mockReturnValue({ getMetadata: mockGetMetadata });
    // Default: empty query result
    mockQuery.mockResolvedValue([[]]);
});

// ────────────────────────────────────────────────────────────────────────────
describe('BigQueryConnector', () => {
    let connector: BigQueryConnector;

    beforeEach(() => {
        connector = new BigQueryConnector();
    });

    // ── validateConfig ───────────────────────────────────────────────────────
    describe('validateConfig', () => {
        it('returns undefined when projectId is present', () => {
            expect(connector.validateConfig(BASE)).toBeUndefined();
        });

        it('returns error when projectId is missing', () => {
            expect(connector.validateConfig({ ...BASE, projectId: '' })).toBe(
                'projectId is required',
            );
        });

        it('returns undefined when optional fields are missing', () => {
            const { location, dataset, ...minimal } = BASE as any;
            expect(connector.validateConfig(minimal)).toBeUndefined();
        });
    });

    // ── BigQuery client options ──────────────────────────────────────────────
    describe('BigQuery client construction', () => {
        it('passes projectId and location to BigQuery constructor', async () => {
            mockQuery.mockResolvedValue([[]]);
            await collect(connector.runQuery('SELECT 1', BASE));
            expect(MockBigQuery).toHaveBeenCalledWith(
                expect.objectContaining({ projectId: 'my-project', location: 'US' }),
            );
        });

        it('defaults location to US when not specified', async () => {
            mockQuery.mockResolvedValue([[]]);
            const { location, ...noLoc } = BASE;
            await collect(connector.runQuery('SELECT 1', noLoc));
            expect(MockBigQuery).toHaveBeenCalledWith(
                expect.objectContaining({ location: 'US' }),
            );
        });

        it('uses keyFilename when provided (no credentials)', async () => {
            mockQuery.mockResolvedValue([[]]);
            const cfg = { ...BASE, keyFilename: '/path/to/key.json' };
            await collect(connector.runQuery('SELECT 1', cfg));
            expect(MockBigQuery).toHaveBeenCalledWith(
                expect.objectContaining({ keyFilename: '/path/to/key.json' }),
            );
        });

        it('uses inline credentials when provided (credentials > keyFilename)', async () => {
            mockQuery.mockResolvedValue([[]]);
            const cfg: BigQueryConfig = {
                ...BASE,
                credentials: { client_email: 'sa@proj.iam.gserviceaccount.com', private_key: '---KEY---' },
                keyFilename: '/ignored.json',
            };
            await collect(connector.runQuery('SELECT 1', cfg));
            const callArgs = MockBigQuery.mock.calls[0][0];
            expect(callArgs.credentials).toBeDefined();
            // keyFilename should NOT be present when credentials are given
            expect(callArgs.keyFilename).toBeUndefined();
        });

        it('sets maximumBytesBilled in query options when configured', async () => {
            mockQuery.mockResolvedValue([[]]);
            const cfg = { ...BASE, maximumBytesBilled: 10_000_000_000 };
            await collect(connector.runQuery('SELECT 1', cfg));
            expect(mockQuery).toHaveBeenCalledWith(
                expect.objectContaining({ maximumBytesBilled: '10000000000' }),
            );
        });

        it('does NOT set maximumBytesBilled when null (unlimited)', async () => {
            mockQuery.mockResolvedValue([[]]);
            const cfg = { ...BASE, maximumBytesBilled: null };
            await collect(connector.runQuery('SELECT 1', cfg));
            const callArg = mockQuery.mock.calls[0][0];
            expect(callArg.maximumBytesBilled).toBeUndefined();
        });
    });

    // ── runQuery — success ───────────────────────────────────────────────────
    describe('runQuery — success', () => {
        it('yields a QueryPage with columns and data', async () => {
            mockQuery.mockResolvedValue([
                [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                ],
            ]);

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

        it('yields empty-column page for zero-row result', async () => {
            mockQuery.mockResolvedValue([[]]);
            const pages = await collect(connector.runQuery('SELECT 1 WHERE false', BASE));
            expect(pages).toHaveLength(1);
            expect(pages[0].columns).toEqual([]);
            expect(pages[0].data).toEqual([]);
            expect(pages[0].stats.rowCount).toBe(0);
        });

        it('infers boolean type from boolean values', async () => {
            mockQuery.mockResolvedValue([[{ flag: true }]]);
            const pages = await collect(connector.runQuery('SELECT true', BASE));
            expect(pages[0].columns[0].type).toBe('boolean');
        });

        it('infers number type from float values', async () => {
            mockQuery.mockResolvedValue([[{ ratio: 3.14 }]]);
            const pages = await collect(connector.runQuery('SELECT 3.14', BASE));
            expect(pages[0].columns[0].type).toBe('number');
        });

        it('infers timestamp type from Date objects', async () => {
            mockQuery.mockResolvedValue([[{ ts: new Date() }]]);
            const pages = await collect(connector.runQuery('SELECT CURRENT_TIMESTAMP()', BASE));
            expect(pages[0].columns[0].type).toBe('timestamp');
        });

        it('returns string type for STRUCT/RECORD (object values)', async () => {
            mockQuery.mockResolvedValue([[{ meta: { a: 1 } }]]);
            const pages = await collect(connector.runQuery('SELECT meta FROM t', BASE));
            expect(pages[0].columns[0].type).toBe('string');
        });

        it('sets defaultDataset when dataset is configured', async () => {
            mockQuery.mockResolvedValue([[]]);
            const cfg = { ...BASE, dataset: 'MY_DATASET' };
            await collect(connector.runQuery('SELECT 1', cfg));
            expect(mockQuery).toHaveBeenCalledWith(
                expect.objectContaining({
                    defaultDataset: { datasetId: 'MY_DATASET', projectId: 'my-project' },
                }),
            );
        });
    });

    // ── abort signal ─────────────────────────────────────────────────────────
    describe('abort signal', () => {
        it('returns no pages when signal is pre-aborted', async () => {
            const signal = { aborted: true } as AbortSignal;
            const pages = await collect(connector.runQuery('SELECT 1', BASE, undefined, signal));
            expect(pages).toHaveLength(0);
            expect(mockQuery).not.toHaveBeenCalled();
        });
    });

    // ── error classification ─────────────────────────────────────────────────
    describe('error classification', () => {
        it('throws AuthenticationError for HTTP 401', async () => {
            mockQuery.mockRejectedValue(
                Object.assign(new Error('Request had invalid authentication credentials'), { code: 401 }),
            );
            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                AuthenticationError,
            );
        });

        it('throws AuthenticationError for HTTP 403', async () => {
            mockQuery.mockRejectedValue(
                Object.assign(new Error('Access denied to table'), { code: 403 }),
            );
            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                AuthenticationError,
            );
        });

        it('throws QueryError for quotaExceeded', async () => {
            mockQuery.mockRejectedValue(
                Object.assign(new Error('Quota exceeded'), {
                    errors: [{ reason: 'quotaExceeded' }],
                }),
            );
            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(QueryError);
        });

        it('throws QueryError with friendly message for bytesBilledLimitExceeded', async () => {
            mockQuery.mockRejectedValue(
                Object.assign(new Error('bytesBilled exceeds limit'), {
                    errors: [{ reason: 'bytesBilledLimitExceeded' }],
                }),
            );
            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                /maximumBytesBilled/,
            );
        });

        it('throws ConnectionError for ECONNREFUSED', async () => {
            mockQuery.mockRejectedValue(new Error('connect ECONNREFUSED'));
            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                ConnectionError,
            );
        });

        it('throws QueryError with location hint for location mismatch', async () => {
            mockQuery.mockRejectedValue(new Error('Not found: Dataset in location EU'));
            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(/location/);
        });

        it('throws QueryError for generic SQL errors', async () => {
            mockQuery.mockRejectedValue(new Error('Syntax error: Expected end of input'));
            await expect(collect(connector.runQuery('SELECTS 1', BASE))).rejects.toThrow(QueryError);
        });
    });

    // ── testConnection ────────────────────────────────────────────────────────
    describe('testConnection', () => {
        it('returns success:true when getDatasets succeeds', async () => {
            mockGetDatasets.mockResolvedValue([[{ id: 'my_dataset' }]]);
            const result = await connector.testConnection(BASE);
            expect(result.success).toBe(true);
        });

        it('returns success:false when auth fails', async () => {
            mockGetDatasets.mockRejectedValue(
                Object.assign(new Error('Access denied'), { code: 403 }),
            );
            const result = await connector.testConnection(BASE);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Access denied');
        });

        it('passes maxResults:1 to getDatasets for efficiency', async () => {
            mockGetDatasets.mockResolvedValue([[]]);
            await connector.testConnection(BASE);
            expect(mockGetDatasets).toHaveBeenCalledWith({ maxResults: 1 });
        });
    });

    // ── listSchemas ───────────────────────────────────────────────────────────
    describe('listSchemas', () => {
        it('returns datasets as schemas with project as catalog', async () => {
            mockGetDatasets.mockResolvedValue([
                [{ id: 'analytics' }, { id: 'raw_data' }],
            ]);
            const schemas = await connector.listSchemas(BASE);
            expect(schemas).toEqual([
                { catalog: 'my-project', schema: 'analytics' },
                { catalog: 'my-project', schema: 'raw_data' },
            ]);
        });
    });

    // ── listTables ────────────────────────────────────────────────────────────
    describe('listTables', () => {
        it('returns tables and views with correct type labels', async () => {
            mockGetTables.mockResolvedValue([
                [
                    { id: 'orders', metadata: { type: 'TABLE' } },
                    { id: 'revenue_view', metadata: { type: 'VIEW' } },
                ],
            ]);
            const tables = await connector.listTables(BASE, 'analytics');
            expect(tables).toEqual([
                { catalog: 'my-project', schema: 'analytics', name: 'orders', type: 'TABLE' },
                { catalog: 'my-project', schema: 'analytics', name: 'revenue_view', type: 'VIEW' },
            ]);
        });
    });

    // ── describeTable ─────────────────────────────────────────────────────────
    describe('describeTable', () => {
        it('returns columns with type, nullable, and ordinalPosition', async () => {
            mockGetMetadata.mockResolvedValue([
                {
                    schema: {
                        fields: [
                            { name: 'id', type: 'INT64', mode: 'REQUIRED', description: 'Primary key' },
                            { name: 'name', type: 'STRING', mode: 'NULLABLE', description: '' },
                            { name: 'created_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
                        ],
                    },
                },
            ]);

            const desc = await connector.describeTable(BASE, 'orders', 'analytics');
            expect(desc.table).toEqual({ catalog: 'my-project', schema: 'analytics', name: 'orders', type: 'TABLE' });
            expect(desc.columns).toHaveLength(3);
            expect(desc.columns[0]).toMatchObject({ name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 });
            expect(desc.columns[1]).toMatchObject({ name: 'name', type: 'string', nullable: true, ordinalPosition: 2 });
            expect(desc.columns[2]).toMatchObject({ name: 'created_at', type: 'timestamp', nullable: true, ordinalPosition: 3 });
        });

        it('handles tables with no description gracefully', async () => {
            mockGetMetadata.mockResolvedValue([{ schema: { fields: [{ name: 'n', type: 'INT64', mode: 'NULLABLE' }] } }]);
            const desc = await connector.describeTable(BASE, 'test', 'ds');
            expect(desc.columns[0].description).toBeUndefined();
        });
    });
});
