import * as fs from 'fs';
import { IConnector, ConnectorConfig, QueryPage, ColumnDef } from '@sql-preview/connector-api';
// Dynamic import requires a type assertion or we can just require
// We'll use require since sql.js has a specific node export
import * as SqlJs from 'sql.js';

export interface SQLiteConfig extends ConnectorConfig {
  databasePath: string;
  driverPath?: string;
}

export default class SQLiteConnector implements IConnector<SQLiteConfig> {
  readonly id = 'sqlite';
  readonly supportsPagination = false;

  readonly configSchema = {
    type: 'object',
    properties: {
      databasePath: {
        type: 'string',
        title: 'Database Path',
        description: 'Absolute path to the .sqlite or .db file',
      },
    },
    required: ['databasePath'],
  };

  private sqlPromise: Promise<SqlJs.SqlJsStatic> | null = null;

  constructor(private readonly driverManager: any) {}

  validateConfig(config: SQLiteConfig): string | undefined {
    if (!config.databasePath) {
      return 'Database path is required';
    }
    return undefined;
  }

  private async getSql(): Promise<SqlJs.SqlJsStatic> {
    if (!this.sqlPromise) {
      // dynamically loading sql.js so we can install it via driver manager
      const driverPath = await this.driverManager.getDriver('sql.js');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const initSqlJs = require(driverPath);
      this.sqlPromise = initSqlJs();
    }
    return this.sqlPromise as Promise<SqlJs.SqlJsStatic>;
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
      const SQL = await this.getSql();

      if (abortSignal?.aborted) {
        return;
      }

      let fileBuffer: Buffer;
      try {
        fileBuffer = await fs.promises.readFile(config.databasePath);
      } catch (err: any) {
        throw new Error(`Failed to load SQLite file at ${config.databasePath}: ${err.message}`);
      }

      if (abortSignal?.aborted) {
        return;
      }

      const db = new SQL.Database(fileBuffer);

      try {
        const stmt = db.prepare(query);
        let columns: ColumnDef[] | null = null;
        const data: unknown[][] = [];

        while (stmt.step()) {
          if (abortSignal?.aborted) {
            stmt.free();
            return;
          }

          if (!columns) {
            columns = stmt.getColumnNames().map(name => ({
              name,
              type: 'unknown',
            }));
          }

          data.push(stmt.get());
        }
        stmt.free();

        if (!columns) {
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
        db.close();
      }
    } catch (e: any) {
      if (e.message?.includes('SQL error')) {
        throw new Error(`SQLite Error: ${e.message}`);
      }
      throw e;
    }
  }
}
