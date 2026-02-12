import type { Database } from 'sqlite3';
import { IConnector, ConnectorConfig } from '../base/IConnector';
import { QueryPage, ColumnDef } from '../../common/types';

export interface SQLiteConfig extends ConnectorConfig {
  databasePath: string;
  driverPath?: string;
}

export class SQLiteConnector implements IConnector<SQLiteConfig> {
  readonly id = 'sqlite';
  readonly supportsPagination = false; // SQLite returns all results at once

  validateConfig(config: SQLiteConfig): string | undefined {
    if (!config.databasePath) {
      return 'Database path is required';
    }
    return undefined;
  }

  async *runQuery(
    query: string,
    config: SQLiteConfig,
    _authHeader?: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown> {
    // Lazy load sqlite3 to avoid startup crashes if native bindings are missing
    // or if we are using dynamic driver loading
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite3: any;
    try {
      if (config.driverPath) {
        sqlite3 = await import(config.driverPath);
      } else {
        sqlite3 = await import('sqlite3');
      }

      if (sqlite3.default) {
        sqlite3 = sqlite3.default;
      }
    } catch (e) {
      throw new Error(
        `SQLite3 module not found (path: ${config.driverPath || 'default'}). Please ensure it is installed and rebuilt for your platform.`
      );
    }

    const db: Database = new sqlite3.Database(config.databasePath);

    // Wait for open
    await new Promise<void>((resolve, reject) => {
      db.once('open', resolve);
      db.once('error', reject);
      // Trigger open verification
      db.get('PRAGMA user_version', err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    try {
      if (abortSignal?.aborted) {
        return;
      }

      // We use a queue to buffer rows from db.each
      // This allows us to yield pages
      const queue: unknown[] = [];
      let columns: ColumnDef[] | undefined;
      let error: Error | undefined;
      let completed = false;
      let resolveNext: (() => void) | undefined;

      // Start execution
      db.each(
        query,
        (err, row) => {
          if (err) {
            error = err;
          } else {
            queue.push(row);
          }
          if (resolveNext) {
            resolveNext();
            resolveNext = undefined;
          }
        },
        err => {
          if (err) {
            error = err;
          }
          completed = true;
          if (resolveNext) {
            resolveNext();
            resolveNext = undefined;
          }
        }
      );

      // Check for synchronous errors immediately
      if (error) {
        throw error;
      }

      // Generator loop
      while (!completed || queue.length > 0) {
        if (abortSignal?.aborted) {
          // If aborted, we stop yielding.
          // The db query continues in background until done, but we close db in finally.
          return;
        }

        if (error) {
          throw error;
        }

        if (queue.length === 0) {
          // Wait for data or completion
          await new Promise<void>(resolve => {
            resolveNext = resolve;
          });
          continue;
        }

        // Flush current queue as a page
        // We take a snapshot of the queue length to batch
        const batchSize = queue.length; // yield all available
        const batch = queue.splice(0, batchSize);

        if (batch.length > 0) {
          if (!columns) {
            // Infer columns from the first row of the first batch
            const firstRow = batch[0] as Record<string, unknown>;
            columns = Object.keys(firstRow).map(key => ({
              name: key,
              type: typeof firstRow[key], // rough type inference
            }));
          }

          // Convert rows to array of values (if that's what QueryPage expects)
          if (columns) {
            const currentColumns = columns; // Capture for closure if needed, though map is sync
            const data = batch.map(row => {
              const r = row as Record<string, unknown>;
              return currentColumns.map(col => r[col.name]);
            });

            yield {
              columns,
              data,
            };
          }
        }
      }
    } finally {
      db.close();
    }
  }
}
