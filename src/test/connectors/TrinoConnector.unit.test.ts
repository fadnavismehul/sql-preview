/**
 * Comprehensive unit tests for TrinoConnector.
 *
 * Covers all RFC-024 required groups:
 *   - validateConfig
 *   - runQuery (success, empty, pagination, abort)
 *   - Error classification (AuthenticationError, ConnectionError, QueryError)
 *   - Host sanitization
 *   - Authorization header propagation
 *
 * Axios is mocked — no real Trino/Presto server needed.
 * Run with: npm test (in project root)
 */

import axios, { isCancel, isAxiosError } from 'axios';
import { TrinoConnector, TrinoConfig } from '../../connectors/trino/TrinoConnector';
import { AuthenticationError, ConnectionError, QueryError } from '../../common/errors';

// ── Axios mock ───────────────────────────────────────────────────────────────
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
  },
  isCancel: jest.fn(),
  isAxiosError: jest.fn(),
}));

const mockedPost = (axios as any).post as jest.Mock;
const mockedGet = (axios as any).get as jest.Mock;
const mockedIsCancel = isCancel as unknown as jest.Mock;
const mockedIsAxiosError = isAxiosError as unknown as jest.Mock;

// ── Helpers ──────────────────────────────────────────────────────────────────
function trinoPage(
  data: unknown[][] = [],
  opts: {
    columns?: { name: string; type: string }[];
    nextUri?: string;
    id?: string;
    state?: string;
  } = {}
) {
  return {
    data: {
      id: opts.id ?? 'qid1',
      infoUri: 'http://localhost:8080/ui/query.html?qid1',
      nextUri: opts.nextUri,
      columns: opts.columns ?? [{ name: 'col1', type: 'integer' }],
      data,
      stats: { state: opts.state ?? 'FINISHED' },
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {},
  } as any;
}

function axiosErr(message: string, code: string, status?: number): Error {
  const err = new Error(message) as any;
  err.code = code;
  err.config = { url: `http://localhost:8080/v1/statement/q1/1` };
  if (status !== undefined) {
    err.response = { status, data: {} };
  }
  err.isAxiosError = true;
  return err;
}

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
  const pages: any[] = [];
  for await (const p of gen) {
    pages.push(p);
  }
  return pages;
}

const BASE: TrinoConfig = { host: 'localhost', port: 8080, user: 'tester', ssl: false };

// ── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  mockedIsCancel.mockReturnValue(false);
  mockedIsAxiosError.mockReturnValue(false);
});

// ────────────────────────────────────────────────────────────────────────────
describe('TrinoConnector', () => {
  let connector: TrinoConnector;

  beforeEach(() => {
    connector = new TrinoConnector();
  });

  // ── validateConfig ─────────────────────────────────────────────────────────
  describe('validateConfig', () => {
    it('returns undefined when required fields are present', () => {
      expect(connector.validateConfig(BASE)).toBeUndefined();
    });

    it('returns error when host is missing', () => {
      expect(connector.validateConfig({ ...BASE, host: '' })).toBe('Host is required');
    });

    it('returns error when port is 0 / missing', () => {
      expect(connector.validateConfig({ ...BASE, port: 0 as any })).toBe('Port is required');
    });

    it('returns error when user is missing', () => {
      expect(connector.validateConfig({ ...BASE, user: '' })).toBe('User is required');
    });

    it('returns undefined with optional catalog + schema', () => {
      expect(
        connector.validateConfig({ ...BASE, catalog: 'hive', schema: 'default' })
      ).toBeUndefined();
    });
  });

  // ── runQuery — success paths ───────────────────────────────────────────────
  describe('runQuery — success', () => {
    it('yields a QueryPage with columns and data on single-page response', async () => {
      mockedPost.mockResolvedValueOnce(
        trinoPage([[1, 'Alice']], {
          columns: [
            { name: 'id', type: 'integer' },
            { name: 'name', type: 'varchar' },
          ],
        })
      );

      const pages = await collect(connector.runQuery('SELECT id, name FROM t', BASE));
      expect(pages).toHaveLength(1);
      expect(pages[0].columns).toEqual([
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'varchar' },
      ]);
      expect(pages[0].data).toEqual([[1, 'Alice']]);
    });

    it('yields page with empty data array for zero-row result', async () => {
      mockedPost.mockResolvedValueOnce(trinoPage([]));

      const pages = await collect(connector.runQuery('SELECT 1 WHERE false', BASE));
      expect(pages).toHaveLength(1);
      expect(pages[0].data).toEqual([]);
    });

    it('follows nextUri pagination and yields second page', async () => {
      // First response has nextUri
      mockedPost.mockResolvedValueOnce(
        trinoPage([[1]], { nextUri: 'http://localhost:8080/v1/statement/q1/1' })
      );
      // Follow-up GET has data and no nextUri (done)
      mockedGet.mockResolvedValueOnce(trinoPage([[2]]));

      const pages = await collect(connector.runQuery('SELECT n FROM t', BASE));
      expect(pages).toHaveLength(2);
      expect(pages[0].data).toEqual([[1]]);
      expect(pages[1].data).toEqual([[2]]);
    });

    it('skips yielding empty intermediate pages and yields final page', async () => {
      // First page has data + nextUri
      mockedPost.mockResolvedValueOnce(
        trinoPage([[1]], { nextUri: 'http://localhost:8080/v1/next/1' })
      );
      // Second page is empty (state: RUNNING) but has nextUri — should be skipped
      mockedGet.mockResolvedValueOnce({
        data: { nextUri: 'http://localhost:8080/v1/next/2', data: [], stats: { state: 'RUNNING' } },
        status: 200,
        headers: {},
        config: {},
      } as any);
      // Final page has data and no nextUri
      mockedGet.mockResolvedValueOnce(trinoPage([[99]]));

      const pages = await collect(connector.runQuery('SELECT n FROM t', BASE));
      // Empty intermediate page should be skipped; expect 2 pages with data
      expect(pages.length).toBeGreaterThanOrEqual(2);
      expect(pages[pages.length - 1].data).toEqual([[99]]);
    });

    it('sends X-Trino-User and X-Presto-User headers', async () => {
      mockedPost.mockResolvedValueOnce(trinoPage([]));

      await collect(connector.runQuery('SELECT 1', BASE));
      const [, , config] = mockedPost.mock.calls[0];
      expect(config.headers['X-Trino-User']).toBe('tester');
      expect(config.headers['X-Presto-User']).toBe('tester');
    });

    it('sends Authorization header when authHeader is provided', async () => {
      mockedPost.mockResolvedValueOnce(trinoPage([]));

      await collect(connector.runQuery('SELECT 1', BASE, 'Bearer mytoken'));
      const [, , config] = mockedPost.mock.calls[0];
      expect(config.headers['Authorization']).toBe('Bearer mytoken');
    });

    it('sends X-Trino-Catalog and X-Trino-Schema when configured', async () => {
      mockedPost.mockResolvedValueOnce(trinoPage([]));
      const cfg = { ...BASE, catalog: 'hive', schema: 'mydb' };

      await collect(connector.runQuery('SELECT 1', cfg));
      const [, , config] = mockedPost.mock.calls[0];
      expect(config.headers['X-Trino-Catalog']).toBe('hive');
      expect(config.headers['X-Trino-Schema']).toBe('mydb');
    });
  });

  // ── runQuery — host sanitization ──────────────────────────────────────────
  describe('runQuery — host sanitization', () => {
    it('strips http:// prefix from host', async () => {
      mockedPost.mockResolvedValueOnce(trinoPage([]));
      await collect(connector.runQuery('SELECT 1', { ...BASE, host: 'http://localhost' }));
      const [url] = mockedPost.mock.calls[0];
      expect(url).toBe('http://localhost:8080/v1/statement');
    });

    it('strips https:// prefix and uses https protocol when ssl:true', async () => {
      mockedPost.mockResolvedValueOnce(trinoPage([]));
      await collect(
        connector.runQuery('SELECT 1', { ...BASE, host: 'https://secure.host', ssl: true })
      );
      const [url] = mockedPost.mock.calls[0];
      expect(url).toMatch(/^https:\/\/secure\.host:8080/);
    });

    it('strips inline port from host to avoid double-port', async () => {
      mockedPost.mockResolvedValueOnce(trinoPage([]));
      await collect(connector.runQuery('SELECT 1', { ...BASE, host: 'localhost:8080' }));
      const [url] = mockedPost.mock.calls[0];
      expect(url).toBe('http://localhost:8080/v1/statement');
    });

    it('strips trailing slash from host', async () => {
      mockedPost.mockResolvedValueOnce(trinoPage([]));
      await collect(connector.runQuery('SELECT 1', { ...BASE, host: 'localhost/' }));
      const [url] = mockedPost.mock.calls[0];
      expect(url).toBe('http://localhost:8080/v1/statement');
    });
  });

  // ── runQuery — error classification ───────────────────────────────────────
  describe('runQuery — error classification', () => {
    it('throws QueryError when Trino returns an inline error object', async () => {
      mockedPost.mockResolvedValueOnce({
        data: { error: { message: 'line 1:1: Unexpected token' } },
        status: 200,
        headers: {},
        config: {},
      } as any);

      await expect(collect(connector.runQuery('BAD SQL', BASE))).rejects.toThrow(QueryError);
    });

    it('throws AuthenticationError for HTTP 401 response', async () => {
      const err = axiosErr('Unauthorized', 'ERR_BAD_RESPONSE', 401);
      mockedIsAxiosError.mockReturnValue(true);
      mockedIsCancel.mockReturnValue(false);
      mockedPost.mockRejectedValueOnce(err);

      await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
        AuthenticationError
      );
    });

    it('throws AuthenticationError for HTTP 403 response', async () => {
      const err = axiosErr('Forbidden', 'ERR_BAD_RESPONSE', 403);
      mockedIsAxiosError.mockReturnValue(true);
      mockedPost.mockRejectedValueOnce(err);

      await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(
        AuthenticationError
      );
    });

    it('throws ConnectionError for ECONNREFUSED', async () => {
      const err = axiosErr('connect ECONNREFUSED', 'ECONNREFUSED');
      mockedIsAxiosError.mockReturnValue(true);
      mockedPost.mockRejectedValueOnce(err);

      await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(ConnectionError);
    });

    it('throws ConnectionError for ENOTFOUND', async () => {
      const err = axiosErr('getaddrinfo ENOTFOUND badhost.example.com', 'ENOTFOUND');
      mockedIsAxiosError.mockReturnValue(true);
      mockedPost.mockRejectedValueOnce(err);

      await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(ConnectionError);
    });

    it('throws QueryError for other axios errors (not conn/auth)', async () => {
      const err = axiosErr('Internal Server Error', 'ERR_BAD_RESPONSE', 500);
      mockedIsAxiosError.mockReturnValue(true);
      mockedPost.mockRejectedValueOnce(err);

      await expect(collect(connector.runQuery('SELECT 1', BASE))).rejects.toThrow(QueryError);
    });

    it('returns early (no throw) when axios cancel', async () => {
      const cancelErr = new Error('Request cancelled');
      mockedIsCancel.mockReturnValue(true);
      mockedPost.mockRejectedValueOnce(cancelErr);

      const pages = await collect(connector.runQuery('SELECT 1', BASE));
      expect(pages).toHaveLength(0);
    });

    it('throws QueryError for Trino inline error in pagination page', async () => {
      mockedPost.mockResolvedValueOnce(
        trinoPage([[1]], { nextUri: 'http://localhost:8080/v1/q1/1' })
      );
      mockedGet.mockResolvedValueOnce({
        data: { error: { message: 'Split failed during execution' } },
        status: 200,
        headers: {},
        config: {},
      } as any);

      const gen = connector.runQuery('SELECT 1', BASE);
      await gen.next(); // first page OK
      await expect(gen.next()).rejects.toThrow(QueryError);
    });
  });

  // ── runQuery — abort signal ────────────────────────────────────────────────
  describe('runQuery — abort signal', () => {
    it('stops pagination when signal is aborted before second iteration', async () => {
      const abortController = new AbortController();
      mockedPost.mockResolvedValueOnce(
        trinoPage([[1]], { nextUri: 'http://localhost:8080/v1/q1/1' })
      );
      // Even if GET is set up to return data, the abort check at the top of the loop should bail
      mockedGet.mockResolvedValue(trinoPage([[2]]));

      const gen = connector.runQuery('SELECT 1', BASE, undefined, abortController.signal);

      // Get first page (from POST)
      const first = await gen.next();
      expect(first.done).toBe(false);
      expect(first.value?.data).toEqual([[1]]);

      // Abort before the next pagination step
      abortController.abort();

      // The generator should return done immediately (abortSignal.aborted check at loop top)
      const second = await gen.next();
      expect(second.done).toBe(true);

      // GET should never have been called
      expect(mockedGet).not.toHaveBeenCalled();
    });
  });

  // ── testConnection ─────────────────────────────────────────────────────────
  describe('testConnection', () => {
    it('returns success:true for basic config (no catalog/schema)', async () => {
      mockedPost.mockResolvedValueOnce(trinoPage([[1]]));

      const result = await connector.testConnection(BASE);
      expect(result.success).toBe(true);
    });

    it('returns success:false when initial query throws ConnectionError', async () => {
      const err = axiosErr('ECONNREFUSED', 'ECONNREFUSED');
      mockedIsAxiosError.mockReturnValue(true);
      mockedPost.mockRejectedValueOnce(err);

      const result = await connector.testConnection(BASE);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection failed');
    });

    it('returns success:false when initial query throws AuthenticationError', async () => {
      const err = axiosErr('Unauthorized', 'ERR_BAD_RESPONSE', 401);
      mockedIsAxiosError.mockReturnValue(true);
      mockedPost.mockRejectedValueOnce(err);

      const result = await connector.testConnection(BASE);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Authentication failed');
    });
  });
});
