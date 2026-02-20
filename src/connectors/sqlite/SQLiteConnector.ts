import * as fs from 'fs';
import { IConnector, ConnectorConfig } from '../base/IConnector';
import { QueryPage, ColumnDef } from '../../common/types';
import initSqlJs, { SqlJsStatic } from 'sql.js';

export interface SQLiteConfig extends ConnectorConfig {
  databasePath: string;
  driverPath?: string; // Obsolete with WASM
}

export class SQLiteConnector implements IConnector<SQLiteConfig> {
  readonly id = 'sqlite';
  readonly supportsPagination = false; // SQLite WASM loads memory, paginating post-execution

  private sqlPromise: Promise<SqlJsStatic> | null = null;

  validateConfig(config: SQLiteConfig): string | undefined {
    if (!config.databasePath) {
      return 'Database path is required';
    }
    return undefined;
  }

  private async getSql(): Promise<SqlJsStatic> {
    if (!this.sqlPromise) {
      this.sqlPromise = initSqlJs();
    }
    return this.sqlPromise;
  }

  async *runQuery(
    query: string,
    config: SQLiteConfig,
    _authHeader?: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown> {
    if (abortSignal?.aborted) {
      return;
    }

    try {
      // 1. Initialize WASM module
      const SQL = await this.getSql();

      if (abortSignal?.aborted) {
        return;
      }

      // 2. Load database file into memory buffer
      let fileBuffer: Buffer;
      try {
        fileBuffer = await fs.promises.readFile(config.databasePath);
      } catch (err: any) {
        throw new Error(`Failed to load SQLite file at ${config.databasePath}: ${err.message}`);
      }

      if (abortSignal?.aborted) {
        return;
      }

      // 3. Instantiate database
      const db = new SQL.Database(fileBuffer);

      try {
        // 4. Prepare and execute the query
        const stmt = db.prepare(query);

        let columns: ColumnDef[] | null = null;
        const data: unknown[][] = [];

        // 5. Gather rows
        while (stmt.step()) {
          if (abortSignal?.aborted) {
            stmt.free();
            return;
          }

          if (!columns) {
            columns = stmt.getColumnNames().map(name => ({
              name,
              // we don't know exact types easily in sql.js without digging into stmt,
              // but we can default generic object or leave vague
              type: 'unknown',
            }));
          }

          data.push(stmt.get());
        }
        stmt.free();

        // If no rows were returned but columns exist (or if we can get them)
        // sql.js doesn't give columns if step() is false on first try, unless we parse schema.
        if (!columns) {
          // It might have been an INSERT/UPDATE or a SELECT making 0 rows.
          // In sql.js, you can get affected rows but not usually empty column names this way
          // We can fallback to empty
          yield {
            columns: [],
            data: [],
          };
        } else {
          yield {
            columns,
            data,
          };
        }
      } finally {
        // 6. Safely free memory
        db.close();
      }
    } catch (e: any) {
      // Improve error message matching
      if (e.message?.includes('SQL error')) {
        throw new Error(`SQLite Error: ${e.message}`);
      }
      throw e;
    }
  }
}
