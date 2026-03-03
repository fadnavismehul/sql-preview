import {
    IConnector,
    ConnectorConfig,
    QueryPage,
    ColumnDef,
    AuthenticationError,
    ConnectionError,
    QueryError,
} from '@sql-preview/connector-api';

// mysql2 field type constants (subset used for type mapping)
// Reference: https://github.com/mysqljs/mysql/blob/master/lib/protocol/constants/field_types.js
const enum FieldType {
    DECIMAL = 0,
    TINY = 1,
    SHORT = 2,
    LONG = 3,
    FLOAT = 4,
    DOUBLE = 5,
    NULL = 6,
    TIMESTAMP = 7,
    LONGLONG = 8,
    INT24 = 9,
    DATE = 10,
    TIME = 11,
    DATETIME = 12,
    YEAR = 13,
    NEWDATE = 14,
    VARCHAR = 15,
    BIT = 16,
    NEWDECIMAL = 246,
    ENUM = 247,
    SET = 248,
    TINY_BLOB = 249,
    MEDIUM_BLOB = 250,
    LONG_BLOB = 251,
    BLOB = 252,
    VAR_STRING = 253,
    STRING = 254,
    GEOMETRY = 255,
}

export interface MySQLConfig extends ConnectorConfig {
    host: string;
    port: number;
    user: string;
    password?: string;
    database: string;
    ssl?: boolean;
    sslVerify?: boolean;
    timezone?: string;
    connectTimeout?: number;
}

function mapMysqlType(typeId: number): string {
    switch (typeId) {
        case FieldType.TINY:
        case FieldType.SHORT:
        case FieldType.LONG:
        case FieldType.LONGLONG:
        case FieldType.INT24:
        case FieldType.YEAR:
            return 'integer';
        case FieldType.FLOAT:
        case FieldType.DOUBLE:
        case FieldType.DECIMAL:
        case FieldType.NEWDECIMAL:
            return 'number';
        case FieldType.TIMESTAMP:
        case FieldType.DATETIME:
        case FieldType.NEWDATE:
            return 'timestamp';
        case FieldType.DATE:
            return 'date';
        case FieldType.BIT:
            return 'boolean';
        default:
            return 'string';
    }
}

// System schemas to exclude from listSchemas results
const SYSTEM_SCHEMAS = new Set([
    'information_schema',
    'performance_schema',
    'mysql',
    'sys',
]);

export default class MySQLConnector implements IConnector<ConnectorConfig> {
    readonly id = 'mysql';
    readonly supportsPagination = false;

    validateConfig(config: ConnectorConfig): string | undefined {
        const cfg = config as MySQLConfig;
        if (!cfg.host) return 'host is required';
        if (!cfg.port) return 'port is required';
        if (!cfg.user) return 'user is required';
        if (!cfg.database) return 'database is required';
        return undefined;
    }

    async *runQuery(
        query: string,
        config: ConnectorConfig,
        _authHeader?: string,
        abortSignal?: AbortSignal,
    ): AsyncGenerator<QueryPage, void, unknown> {
        const cfg = config as MySQLConfig;

        // Dynamically import to allow external bundling
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mysql2 = require('mysql2/promise');

        const connection = await mysql2.createConnection({
            host: cfg.host,
            port: cfg.port ?? 3306,
            user: cfg.user,
            password: cfg.password,
            database: cfg.database,
            ssl: cfg.ssl ? { rejectUnauthorized: cfg.sslVerify ?? true } : undefined,
            timezone: cfg.timezone ?? 'local',
            connectTimeout: cfg.connectTimeout ?? 10000,
        }).catch((err: NodeJS.ErrnoException & { errno?: number; code?: string }) => {
            this.handleError(err, query);
        });

        if (!connection) return;

        try {
            if (abortSignal?.aborted) return;

            // rowsAsArray: true — returns rows as unknown[][] (not objects), matching IConnector contract
            const [rows, fields] = await connection.query({
                sql: query,
                rowsAsArray: true,
            }).catch((err: unknown) => {
                this.handleError(err, query);
            }) as [unknown[][], any[]];

            if (abortSignal?.aborted) return;

            const columns: ColumnDef[] = (fields ?? []).map((f: any) => ({
                name: f.name,
                type: mapMysqlType(f.type),
            }));

            yield {
                columns,
                data: rows ?? [],
                stats: {
                    state: 'FINISHED',
                    rowCount: rows?.length ?? 0,
                },
            };
        } finally {
            await connection.end().catch(() => { /* ignore close errors */ });
        }
    }

    async testConnection(
        config: ConnectorConfig,
    ): Promise<{ success: boolean; error?: string }> {
        const cfg = config as MySQLConfig;

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mysql2 = require('mysql2/promise');

        let connection: any;
        try {
            connection = await mysql2.createConnection({
                host: cfg.host,
                port: cfg.port ?? 3306,
                user: cfg.user,
                password: cfg.password,
                database: cfg.database,
                ssl: cfg.ssl ? { rejectUnauthorized: cfg.sslVerify ?? true } : undefined,
                connectTimeout: cfg.connectTimeout ?? 10000,
            });
            await connection.ping();
            return { success: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        } finally {
            if (connection) {
                await connection.end().catch(() => { /* ignore */ });
            }
        }
    }

    async listSchemas(config: ConnectorConfig): Promise<{ catalog?: string; schema: string }[]> {
        const cfg = config as MySQLConfig;
        const rows = await this.runMetadataQuery(
            cfg,
            `SELECT SCHEMA_NAME AS \`schema\`
       FROM information_schema.SCHEMATA
       ORDER BY SCHEMA_NAME`,
        );
        return rows
            .filter((r: any) => !SYSTEM_SCHEMAS.has(String(r[0]).toLowerCase()))
            .map((r: any) => ({ schema: String(r[0]) }));
    }

    async listTables(
        config: ConnectorConfig,
        schema: string,
    ): Promise<{ catalog?: string; schema: string; name: string; type: string; comment?: string }[]> {
        const cfg = config as MySQLConfig;
        const rows = await this.runMetadataQuery(
            cfg,
            `SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
            [schema],
        );
        return rows.map((r: any) => ({
            schema,
            name: String(r[0]),
            type: String(r[1]) === 'VIEW' ? 'VIEW' : 'TABLE',
            comment: r[2] ? String(r[2]) : undefined,
        }));
    }

    async describeTable(
        config: ConnectorConfig,
        table: string,
        schema: string,
    ): Promise<{
        table: { schema: string; name: string; type: string };
        columns: {
            name: string; type: string; nullable: boolean;
            ordinalPosition: number; defaultValue?: string;
            comment?: string; isPrimaryKey?: boolean;
        }[];
    }> {
        const cfg = config as MySQLConfig;

        // Get primary keys for this table
        const pkRows = await this.runMetadataQuery(
            cfg,
            `SELECT COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         AND CONSTRAINT_NAME = 'PRIMARY'`,
            [schema, table],
        );
        const primaryKeys = new Set(pkRows.map((r: any) => String(r[0])));

        const colRows = await this.runMetadataQuery(
            cfg,
            `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
              ORDINAL_POSITION, COLUMN_DEFAULT, COLUMN_COMMENT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
            [schema, table],
        );

        const columns = colRows.map((r: any) => ({
            name: String(r[0]),
            type: String(r[1]),
            nullable: String(r[2]) === 'YES',
            ordinalPosition: Number(r[3]),
            defaultValue: r[4] != null ? String(r[4]) : undefined,
            comment: r[5] ? String(r[5]) : undefined,
            isPrimaryKey: primaryKeys.has(String(r[0])),
        }));

        return {
            table: { schema, name: table, type: 'TABLE' },
            columns,
        };
    }

    private async runMetadataQuery(
        cfg: MySQLConfig,
        sql: string,
        params: unknown[] = [],
    ): Promise<unknown[][]> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mysql2 = require('mysql2/promise');
        const connection = await mysql2.createConnection({
            host: cfg.host,
            port: cfg.port ?? 3306,
            user: cfg.user,
            password: cfg.password,
            database: cfg.database ?? 'information_schema',
            ssl: cfg.ssl ? { rejectUnauthorized: cfg.sslVerify ?? true } : undefined,
            connectTimeout: cfg.connectTimeout ?? 10000,
        });
        try {
            const [rows] = await connection.query({ sql, values: params, rowsAsArray: true });
            return rows as unknown[][];
        } finally {
            await connection.end().catch(() => { /* ignore */ });
        }
    }

    private handleError(err: unknown, query?: string): never {
        const e = err as Error & { code?: string; errno?: number };
        const msg = e.message || String(err);
        const code = e.code ?? '';

        // ER_ACCESS_DENIED_ERROR, ER_NOT_SUPPORTED_AUTH_MODE
        if (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_NOT_SUPPORTED_AUTH_MODE') {
            throw new AuthenticationError(`Authentication failed: ${msg}`);
        }
        // Network / host unreachable
        if (
            code === 'ECONNREFUSED' ||
            code === 'ENOTFOUND' ||
            code === 'ETIMEDOUT' ||
            code === 'ECONNRESET'
        ) {
            throw new ConnectionError(`Connection failed: ${msg}`);
        }
        // Generic auth fallback
        if (msg.toLowerCase().includes('access denied') || msg.toLowerCase().includes('password')) {
            throw new AuthenticationError(msg);
        }
        throw new QueryError(`Query failed: ${msg}`, query);
    }
}
