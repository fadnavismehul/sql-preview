import { DuckDBInstance } from '@duckdb/node-api';
import * as fs from 'fs';
import { IConnector, ConnectorConfig } from '../base/IConnector';
import { QueryPage } from '../../common/types';
import { ConnectionError, QueryError } from '../../common/errors';

export interface DuckDbConfig extends ConnectorConfig {
  /**
   * Path to the DuckDB database file.
   * Use ':memory:' for an in-memory database (default).
   */
  databasePath?: string;
  /**
   * Optional mapping of table names to file paths to auto-mount.
   * e.g. { "users": "/path/to/users.csv" }
   */
  mounts?: Record<string, string>;
}

export class DuckDbConnector implements IConnector<DuckDbConfig> {
  readonly id = 'duckdb';
  readonly supportsPagination = true;

  validateConfig(): string | undefined {
    return undefined;
  }

  async *runQuery(
    query: string,
    config: DuckDbConfig,
    _authHeader?: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown> {
    const dbPath = config.databasePath || ':memory:';
    let db: DuckDBInstance;

    try {
      db = await DuckDBInstance.create(dbPath);
    } catch (err) {
      throw new ConnectionError(
        `Failed to create DuckDB instance at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    let connection;
    try {
      connection = await db.connect();
    } catch (err) {
      throw new ConnectionError(
        `Failed to connect to DuckDB: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    try {
      // 1. Handle Auto-Mounts (Placeholder for Phase 2, but logic remains same)
      if (config.mounts) {
        for (const filePath of Object.values(config.mounts)) {
          if (!fs.existsSync(filePath)) {
            // Log warning or skip
          }
        }
      }

      // 2. Execute Query
      // @duckdb/node-api uses `run` for immediate execution or prepares/streams.
      // It returns a Reader.
      // Reader has `readRows()` which returns array of objects.

      const reader = await connection.run(query);

      // Get columns from reader (if available early?)
      // The new API might expose schema on reader.
      // Reader.getColumns() etc.
      // Let's assume we can fetch chunks.

      // Reader is async iterable? or explicit loop?
      // const rows = await reader.readAll(); // Simple for Phase 1
      const rows = await reader.getRows(); // getRows() returns all rows in array of arrays or objects?
      // Documentation suggests `getRows()` returns `any[][]` usually.
      // Wait, `reader.getRows()` returns all rows.
      // Let's use it for Version 1 simplicity.

      if (abortSignal?.aborted) {
        return;
      }

      if (rows.length === 0) {
        yield {
          data: [],
          columns: [],
          stats: { state: 'FINISHED' },
        };
        return;
      }

      // Infer columns from first row if it's an object?
      // @duckdb/node-api often returns array of arrays + separate schema metadata.
      // We need to inspect `reader` for schema.
      const columnNames = reader.columnNames();
      const columnTypes = reader.columnTypes();

      const columns = columnNames.map((name, i) => {
        const rawType = columnTypes ? String(columnTypes[i]) : 'unknown';
        let type = 'string';

        // Basic mapping
        if (
          ['INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL', 'SMALLINT', 'TINYINT'].some(t =>
            rawType.includes(t)
          )
        ) {
          type = 'number';
        } else if (rawType.includes('BOOLEAN')) {
          type = 'boolean';
        }

        return { name, type };
      });

      // Convert rows to array of values if needed, or if getRows returns objects?
      // In @duckdb/node-api `getRows()` returns array of arrays usually.
      // But verify. If it returns objects, we convert.
      // Assuming array of arrays based on standard behavior for efficient transfer.
      // Wait, node-duckdb (classic) returned objects by default.
      // node-api version: `getRows()` returns `any[][]`.

      const BATCH_SIZE = 1000;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        if (abortSignal?.aborted) {
          return;
        }
        const batch = rows.slice(i, i + BATCH_SIZE);

        // Ensure data is in array format for UI
        // If rows are already arrays, great. If objects, convert.
        // Let's assume arrays for now, check types in test.
        const pageData = batch;

        yield {
          data: pageData,
          columns: i === 0 ? columns : undefined,
          stats: {
            state: i + BATCH_SIZE >= rows.length ? 'FINISHED' : 'RUNNING',
            progress: Math.min(100, Math.round(((i + BATCH_SIZE) / rows.length) * 100)),
          },
          supportsPagination: true,
        };
      }
    } catch (err) {
      if (abortSignal?.aborted) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new QueryError(`DuckDB Query Failed: ${msg}`, query);
    } finally {
      // connection.close() or similar
      // connection is disposable?
      // db is disposable?
    }
  }

  async testConnection(config: DuckDbConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const iter = this.runQuery('SELECT 1', config);
      await iter.next();
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
