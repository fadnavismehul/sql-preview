/**
 * Unit tests for SnowflakeConnector.
 *
 * 'snowflake-sdk' is mocked — no real Snowflake account needed.
 * Run with: npm test
 */

// ── Mock snowflake-sdk ───────────────────────────────────────────────────────
const mockConnect = jest.fn();
const mockExecute = jest.fn();
const mockDestroy = jest.fn();

const mockConnection = {
    connect: mockConnect,
    execute: mockExecute,
    destroy: mockDestroy,
};

const mockCreateConnection = jest.fn().mockReturnValue(mockConnection);

jest.mock('snowflake-sdk', () => ({ createConnection: mockCreateConnection }), { virtual: true });

// Mock fs and crypto for key pair auth tests
jest.mock('fs', () => ({ readFileSync: jest.fn() }));
jest.mock('crypto', () => ({
    createPrivateKey: jest.fn().mockReturnValue({
        export: jest.fn().mockReturnValue('-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----'),
    }),
}));

import SnowflakeConnector, { SnowflakeConfig } from '../index';
import { AuthenticationError, ConnectionError, QueryError } from '@sql-preview/connector-api';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
    const pages: any[] = [];
    for await (const p of gen) pages.push(p);
    return pages;
}

/** Simulate a successful connect callback */
function setupConnect(err?: Error) {
    mockConnect.mockImplementation((cb: (err?: Error) => void) => cb(err));
}

/** Simulate a successful execute callback */
function setupExecute(rows: Record<string, unknown>[], err?: Error) {
    mockExecute.mockImplementation(
        ({ complete }: { complete: (err: Error | undefined, stmt: null, rows: any[]) => void }) => {
            complete(err, null, rows);
        },
    );
}

/** Simulate destroy callback */
function setupDestroy() {
    mockDestroy.mockImplementation((cb: (err?: Error) => void) => cb(undefined));
}

const BASE: SnowflakeConfig = {
    account: 'myorg-myaccount',
    username: 'testuser',
    password: 'testpass',
    warehouse: 'COMPUTE_WH',
    database: 'MYDB',
};

beforeEach(() => {
    jest.resetAllMocks();
    mockCreateConnection.mockReturnValue(mockConnection);
    setupConnect();
    setupDestroy();
    // Default: empty result
    setupExecute([]);
    // Re-setup crypto mock (resetAllMocks clears the factory implementations)
    const { createPrivateKey } = require('crypto');
    (createPrivateKey as jest.Mock).mockReturnValue({
        export: jest.fn().mockReturnValue('-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----'),
    });
});


// ────────────────────────────────────────────────────────────────────────────
describe('SnowflakeConnector', () => {
    let connector: SnowflakeConnector;

    beforeEach(() => {
        connector = new SnowflakeConnector();
    });

    // ── validateConfig ───────────────────────────────────────────────────────
    describe('validateConfig', () => {
        it('returns undefined when account and username are present', () => {
            expect(connector.validateConfig(BASE)).toBeUndefined();
        });

        it('returns error when account is missing', () => {
            expect(connector.validateConfig({ ...BASE, account: '' })).toBe('account is required');
        });

        it('returns error when username is missing', () => {
            expect(connector.validateConfig({ ...BASE, username: '' })).toBe('username is required');
        });

        it('returns undefined even when warehouse is missing (non-fatal)', () => {
            const { warehouse, ...noWarehouse } = BASE as any;
            expect(connector.validateConfig(noWarehouse)).toBeUndefined();
        });
    });

    // ── account identifier normalisation ─────────────────────────────────────
    describe('account identifier normalisation', () => {
        it('strips https:// prefix', async () => {
            setupExecute([{ n: 1 }]);
            await collect(connector.runQuery('SELECT 1', { ...BASE, account: 'https://myorg-myaccount' }));
            const opts = mockCreateConnection.mock.calls[0][0];
            expect(opts.account).toBe('myorg-myaccount');
        });

        it('strips .snowflakecomputing.com suffix', async () => {
            setupExecute([{ n: 1 }]);
            await collect(
                connector.runQuery('SELECT 1', {
                    ...BASE,
                    account: 'myorg-myaccount.snowflakecomputing.com',
                }),
            );
            const opts = mockCreateConnection.mock.calls[0][0];
            expect(opts.account).toBe('myorg-myaccount');
        });

        it('strips full URL', async () => {
            setupExecute([{ n: 1 }]);
            await collect(
                connector.runQuery('SELECT 1', {
                    ...BASE,
                    account: 'https://myorg-myaccount.snowflakecomputing.com/',
                }),
            );
            const opts = mockCreateConnection.mock.calls[0][0];
            expect(opts.account).toBe('myorg-myaccount');
        });

        it('leaves a clean account identifier unchanged', async () => {
            setupExecute([{ n: 1 }]);
            await collect(connector.runQuery('SELECT 1', BASE));
            const opts = mockCreateConnection.mock.calls[0][0];
            expect(opts.account).toBe('myorg-myaccount');
        });
    });

    // ── runQuery — success ───────────────────────────────────────────────────
    describe('runQuery — success', () => {
        it('yields a QueryPage with columns and data', async () => {
            setupExecute([
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' },
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

        it('yields a page with empty data for zero-row result', async () => {
            setupExecute([]);

            const pages = await collect(connector.runQuery('SELECT 1 WHERE 1=0', BASE));
            expect(pages).toHaveLength(1);
            expect(pages[0].data).toEqual([]);
            expect(pages[0].columns).toEqual([]);
        });

        it('infers boolean type from boolean values', async () => {
            setupExecute([{ active: true }]);
            const pages = await collect(connector.runQuery('SELECT active FROM t', BASE));
            expect(pages[0].columns[0].type).toBe('boolean');
        });

        it('infers number type from float values', async () => {
            setupExecute([{ ratio: 3.14 }]);
            const pages = await collect(connector.runQuery('SELECT ratio FROM t', BASE));
            expect(pages[0].columns[0].type).toBe('number');
        });

        it('infers integer type from integer values', async () => {
            setupExecute([{ count: 42 }]);
            const pages = await collect(connector.runQuery('SELECT count(*)', BASE));
            expect(pages[0].columns[0].type).toBe('integer');
        });

        it('calls destroy after successful query', async () => {
            setupExecute([]);
            await collect(connector.runQuery('SELECT 1', BASE));
            expect(mockDestroy).toHaveBeenCalledTimes(1);
        });

        it('calls destroy even when execute throws', async () => {
            setupExecute([], new Error('query error'));
            await collect(connector.runQuery('FAIL', BASE)).catch(() => { });
            expect(mockDestroy).toHaveBeenCalledTimes(1);
        });
    });

    // ── Connection options ────────────────────────────────────────────────────
    describe('connection options', () => {
        it('passes warehouse, database, schema, role to sdk', async () => {
            setupExecute([]);
            const cfg: SnowflakeConfig = { ...BASE, schema: 'PUBLIC', role: 'SYSADMIN' };
            await collect(connector.runQuery('SELECT 1', cfg));
            const opts = mockCreateConnection.mock.calls[0][0];
            expect(opts.warehouse).toBe('COMPUTE_WH');
            expect(opts.database).toBe('MYDB');
            expect(opts.schema).toBe('PUBLIC');
            expect(opts.role).toBe('SYSADMIN');
        });

        it('defaults application to sql-preview', async () => {
            setupExecute([]);
            await collect(connector.runQuery('SELECT 1', BASE));
            const opts = mockCreateConnection.mock.calls[0][0];
            expect(opts.application).toBe('sql-preview');
        });

        it('uses custom application name when provided', async () => {
            setupExecute([]);
            await collect(connector.runQuery('SELECT 1', { ...BASE, application: 'my-app' }));
            const opts = mockCreateConnection.mock.calls[0][0];
            expect(opts.application).toBe('my-app');
        });

        it('sets privateKey instead of password when privateKeyPath is given', async () => {
            const { readFileSync } = require('fs');
            (readFileSync as jest.Mock).mockReturnValue('-----BEGIN EC PRIVATE KEY-----\nMOCK\n-----END EC PRIVATE KEY-----');
            setupExecute([]);
            const cfg: SnowflakeConfig = { ...BASE, password: undefined, privateKeyPath: '/keys/rsa_key.pem' };
            await collect(connector.runQuery('SELECT 1', cfg));
            const opts = mockCreateConnection.mock.calls[0][0];
            expect(opts.privateKey).toBeDefined();
            expect(opts.password).toBeUndefined();
        });
    });

    // ── abort signal ─────────────────────────────────────────────────────────
    describe('abort signal', () => {
        it('returns no pages when signal is pre-aborted', async () => {
            setupExecute([{ n: 1 }]);
            const signal = { aborted: true } as AbortSignal;
            const pages = await collect(connector.runQuery('SELECT 1', BASE, undefined, signal));
            expect(pages).toHaveLength(0);
            // destroy should still be called
            expect(mockDestroy).toHaveBeenCalled();
        });
    });

    // ── error classification ─────────────────────────────────────────────────
    describe('error classification', () => {
        it('throws AuthenticationError for Snowflake error code 390100', async () => {
            const err = Object.assign(new Error('Incorrect username or password'), { code: 390100 });
            setupConnect(err);

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                AuthenticationError,
            );
        });

        it('throws AuthenticationError for Snowflake error code 390001 (user locked)', async () => {
            const err = Object.assign(new Error('User account is locked'), { code: 390001 });
            setupConnect(err);

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                AuthenticationError,
            );
        });

        it('throws AuthenticationError for login-related message', async () => {
            setupConnect(new Error('Login failed for user testuser'));

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                AuthenticationError,
            );
        });

        it('throws ConnectionError for ECONNREFUSED', async () => {
            setupConnect(new Error('connect ECONNREFUSED 1.2.3.4:443'));

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                ConnectionError,
            );
        });

        it('throws ConnectionError for ENOTFOUND', async () => {
            setupConnect(new Error('getaddrinfo ENOTFOUND myorg-myaccount.snowflakecomputing.com'));

            await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
                ConnectionError,
            );
        });

        it('throws QueryError for SQL compilation errors', async () => {
            setupExecute([], new Error('SQL compilation error: syntax error'));

            await expect(collect(connector.runQuery('SELECTS 1', BASE))).rejects.toThrow(
                QueryError,
            );
        });

        it('throws QueryError for generic execute errors', async () => {
            setupExecute([], new Error('Unknown column "foo"'));

            await expect(collect(connector.runQuery('SELECT foo', BASE))).rejects.toThrow(
                QueryError,
            );
        });
    });

    // ── testConnection ────────────────────────────────────────────────────────
    describe('testConnection', () => {
        it('returns success:true when SELECT CURRENT_TIMESTAMP() succeeds', async () => {
            setupExecute([{ 'CURRENT_TIMESTAMP()': '2026-03-03 00:00:00' }]);
            const result = await connector.testConnection(BASE);
            expect(result.success).toBe(true);
        });

        it('returns success:false when connection fails', async () => {
            setupConnect(new Error('ENOTFOUND'));
            const result = await connector.testConnection(BASE);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Connection failed');
        });

        it('destroys connection after test', async () => {
            setupExecute([{ ts: '2026-03-03' }]);
            await connector.testConnection(BASE);
            expect(mockDestroy).toHaveBeenCalledTimes(1);
        });
    });
});
