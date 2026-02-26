import * as fs from 'fs';
import { IConnector, ConnectorConfig, QueryPage, ColumnDef, ConnectionError, QueryError } from '@sql-preview/connector-api';
// Dynamic require instead of static import to ensure it resolves from driver package
import * as duckdbApi from '@duckdb/node-api';

export interface DuckDbConfig extends ConnectorConfig {
    databasePath?: string;
    mounts?: Record<string, string>;
}

export default class DuckDbConnector implements IConnector<DuckDbConfig> {
    readonly id = 'duckdb';
    readonly supportsPagination = true;

    constructor(private readonly driverManager: any) { }

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
        let db: duckdbApi.DuckDBInstance;

        try {
            db = await duckdbApi.DuckDBInstance.create(dbPath);
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
            if (config.mounts) {
                for (const filePath of Object.values(config.mounts)) {
                    if (!fs.existsSync(filePath)) {
                        // Log warning or skip
                    }
                }
            }

            const reader = await connection.run(query);
            const rows = await reader.getRows();

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

            const columnNames = reader.columnNames();
            const columnTypes = reader.columnTypes();

            const columns = columnNames.map((name, i) => {
                const rawType = columnTypes ? String(columnTypes[i]) : 'unknown';
                let type = 'string';

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

            const BATCH_SIZE = 1000;
            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                if (abortSignal?.aborted) {
                    return;
                }
                const batch = rows.slice(i, i + BATCH_SIZE);

                const pageData = batch.map((row: any[]) =>
                    row.map(cell => (typeof cell === 'bigint' ? Number(cell) : cell))
                );

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
            // Clean up if needed
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
