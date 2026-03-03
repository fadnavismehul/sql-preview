/**
 * Unit tests for SQLiteConnector.
 *
 * sql.js and fs.promises are mocked — no real file or WASM module needed.
 * Run with: npm test
 */

// ── Mock sql.js ──────────────────────────────────────────────────────────────
const mockStep = jest.fn();
const mockGet = jest.fn();
const mockFree = jest.fn();
const mockGetColumnNames = jest.fn();
const mockPrepare = jest.fn().mockImplementation(() => ({
    step: mockStep,
    get: mockGet,
    free: mockFree,
    getColumnNames: mockGetColumnNames,
}));
const mockClose = jest.fn();
const MockDatabase = jest.fn().mockImplementation(() => ({
    prepare: mockPrepare,
    close: mockClose,
}));

// initSqlJs() returns a SqlJsStatic object with a Database constructor
const mockInitSqlJs = jest.fn().mockResolvedValue({ Database: MockDatabase });

// The connector requires sql.js via driverManager.getDriver('sql.js')
// We mock the driverManager to return a path, then mock that require
jest.mock('sql.js', () => mockInitSqlJs, { virtual: true });

// ── Mock fs.promises ─────────────────────────────────────────────────────────
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn().mockResolvedValue(Buffer.from('fake-sqlite-data')),
    },
}));

import SQLiteConnector from '../index';
import * as fs from 'fs';

const mockDriverManager = {
    getDriver: jest.fn().mockResolvedValue('sql.js'),
};

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
    const pages: any[] = [];
    for await (const p of gen) pages.push(p);
    return pages;
}

const baseConfig = { databasePath: '/tmp/test.db' } as any;

beforeEach(() => {
    jest.clearAllMocks();
    (fs.promises.readFile as jest.Mock).mockResolvedValue(Buffer.alloc(0));
    mockInitSqlJs.mockResolvedValue({ Database: MockDatabase });
    MockDatabase.mockClear();
    mockPrepare.mockImplementation(() => ({
        step: mockStep,
        get: mockGet,
        free: mockFree,
        getColumnNames: mockGetColumnNames,
    }));
});

describe('SQLiteConnector', () => {
    let connector: SQLiteConnector;

    beforeEach(() => {
        connector = new SQLiteConnector(mockDriverManager);
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('validateConfig', () => {
        it('returns undefined when databasePath is present', () => {
            expect(connector.validateConfig({ databasePath: '/tmp/test.db' } as any)).toBeUndefined();
        });

        it('returns error when databasePath is missing', () => {
            expect(connector.validateConfig({} as any)).toBe('Database path is required');
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('runQuery', () => {
        it('yields QueryPage with columns and data on success', async () => {
            mockGetColumnNames.mockReturnValue(['id', 'name']);
            mockStep
                .mockReturnValueOnce(true) // first row
                .mockReturnValueOnce(false); // done
            mockGet.mockReturnValue([1, 'Alice']);

            const pages = await collect(connector.runQuery('SELECT * FROM t', baseConfig));
            expect(pages).toHaveLength(1);
            expect(pages[0].columns).toEqual([
                { name: 'id', type: 'unknown' },
                { name: 'name', type: 'unknown' },
            ]);
            expect(pages[0].data).toEqual([[1, 'Alice']]);
        });

        it('yields page with empty data for zero-row result', async () => {
            mockStep.mockReturnValue(false); // no rows

            const pages = await collect(connector.runQuery('SELECT * FROM t WHERE false', baseConfig));
            expect(pages).toHaveLength(1);
            expect(pages[0].data).toEqual([]);
            expect(pages[0].columns).toEqual([]);
        });

        it('throws when file read fails', async () => {
            (fs.promises.readFile as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));

            await expect(collect(connector.runQuery('SELECT 1', baseConfig))).rejects.toThrow(
                'Failed to load SQLite file',
            );
        });

        it('wraps SQL error from sql.js', async () => {
            mockPrepare.mockImplementation(() => {
                throw new Error('SQL error: near "SELECTS": syntax error');
            });

            await expect(
                collect(connector.runQuery('SELECTS * FROM t', baseConfig)),
            ).rejects.toThrow('SQLite Error');
        });

        it('calls db.close() after iteration', async () => {
            mockStep.mockReturnValue(false);

            await collect(connector.runQuery('SELECT 1', baseConfig));
            expect(mockClose).toHaveBeenCalledTimes(1);
        });

        it('calls stmt.free() after iteration', async () => {
            mockStep.mockReturnValue(false);

            await collect(connector.runQuery('SELECT 1', baseConfig));
            expect(mockFree).toHaveBeenCalledTimes(1);
        });

        it('returns early when abortSignal is already aborted', async () => {
            const signal = { aborted: true } as AbortSignal;
            const pages = await collect(connector.runQuery('SELECT 1', baseConfig, undefined, signal));
            expect(pages).toHaveLength(0);
            expect(MockDatabase).not.toHaveBeenCalled();
        });
    });
});
