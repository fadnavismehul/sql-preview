import {
    IConnector,
    ConnectorConfig,
    QueryPage,
    ColumnDef,
    AuthenticationError,
    ConnectionError,
    QueryError,
} from '@sql-preview/connector-api';

// ── Config ───────────────────────────────────────────────────────────────────

export interface MSSQLConfig extends ConnectorConfig {
    host: string;
    port?: number; // default: 1433
    user: string;
    password?: string;
    database: string;
    instance?: string; // named instance, e.g. SQLEXPRESS
    ssl?: boolean; // maps to mssql `encrypt` option; default true for Azure SQL
    trustServerCertificate?: boolean; // true for local dev / self-signed certs
    connectionTimeout?: number; // ms, default: 15000
    requestTimeout?: number; // ms, default: 30000
    domain?: string; // NTLM domain (Windows auth — optional)
}

// ── Type mapping ─────────────────────────────────────────────────────────────
// mssql exposes type declarations via result.recordset.columns[name].type.declaration

function mapMssqlType(declaration: string): string {
    const d = declaration.toUpperCase();
    if (/^(INT|BIGINT|SMALLINT|TINYINT)$/.test(d)) return 'integer';
    if (/^(FLOAT|REAL|DECIMAL|NUMERIC|MONEY|SMALLMONEY)$/.test(d)) return 'number';
    if (/^(DATETIME|DATETIME2|SMALLDATETIME|DATETIMEOFFSET)$/.test(d)) return 'timestamp';
    if (d === 'DATE') return 'date';
    if (d === 'BIT') return 'boolean';
    // varchar, nvarchar, char, nchar, text, ntext, xml, uniqueidentifier, binary, etc.
    return 'string';
}

// ── System schemas to exclude from listSchemas ──────────────────────────────

const SYSTEM_SCHEMAS = new Set([
    'db_accessadmin',
    'db_backupoperator',
    'db_datareader',
    'db_datawriter',
    'db_ddladmin',
    'db_denydatareader',
    'db_denydatawriter',
    'db_owner',
    'db_securityadmin',
    'guest',
    'INFORMATION_SCHEMA',
    'information_schema',
    'sys',
]);

// ── Connector ────────────────────────────────────────────────────────────────

export default class MSSQLConnector implements IConnector<ConnectorConfig> {
    readonly id = 'mssql';
    readonly supportsPagination = false;

    // ── Validation ──────────────────────────────────────────────────────────

    validateConfig(config: ConnectorConfig): string | undefined {
        const cfg = config as MSSQLConfig;
        if (!cfg.host) return 'host is required';
        if (!cfg.user) return 'user is required';
        if (!cfg.database) return 'database is required';
        return undefined;
    }

    // ── runQuery ────────────────────────────────────────────────────────────

    async *runQuery(
        query: string,
        config: ConnectorConfig,
        _authHeader?: string,
        abortSignal?: AbortSignal,
    ): AsyncGenerator<QueryPage, void, unknown> {
        const cfg = config as MSSQLConfig;

        // Auto-detect Azure SQL: encrypt by default when host ends with .database.windows.net
        const isAzureSql = cfg.host.toLowerCase().endsWith('.database.windows.net');
        const encrypt = cfg.ssl ?? isAzureSql ? true : false;

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mssql = require('mssql');

        const poolConfig = {
            server: cfg.host,
            port: cfg.port ?? 1433,
            user: cfg.user,
            password: cfg.password,
            database: cfg.database,
            options: {
                encrypt,
                trustServerCertificate: cfg.trustServerCertificate ?? false,
                instanceName: cfg.instance,
                domain: cfg.domain,
            },
            connectionTimeout: cfg.connectionTimeout ?? 15000,
            requestTimeout: cfg.requestTimeout ?? 30000,
            pool: { max: 1, min: 0, idleTimeoutMillis: 2000 },
        };

        let pool: any;
        try {
            pool = await mssql.connect(poolConfig);
        } catch (err) {
            this.handleError(err, query);
        }

        try {
            if (abortSignal?.aborted) return;

            let result: any;
            try {
                result = await pool.request().query(query);
            } catch (err) {
                this.handleError(err, query);
            }

            if (abortSignal?.aborted) return;

            const recordset: Record<string, unknown>[] = result.recordset ?? [];

            // Build column definitions from mssql column metadata when available
            let columns: ColumnDef[];
            if (result.recordset?.columns) {
                columns = Object.entries(result.recordset.columns).map(([name, col]: [string, any]) => ({
                    name,
                    type: mapMssqlType(col?.type?.declaration ?? ''),
                }));
            } else if (recordset.length > 0) {
                columns = Object.keys(recordset[0]).map(name => ({ name, type: 'string' }));
            } else {
                columns = [];
            }

            // Convert object rows to arrays aligned to column order
            const data: unknown[][] = recordset.map(row => columns.map(c => row[c.name]));

            yield {
                columns,
                data,
                stats: {
                    state: 'FINISHED',
                    rowCount: recordset.length,
                },
            };
        } finally {
            if (pool) {
                await pool.close().catch(() => { /* ignore */ });
            }
        }
    }

    // ── testConnection ──────────────────────────────────────────────────────

    async testConnection(
        config: ConnectorConfig,
    ): Promise<{ success: boolean; error?: string }> {
        const cfg = config as MSSQLConfig;
        const isAzureSql = cfg.host.toLowerCase().endsWith('.database.windows.net');
        const encrypt = cfg.ssl ?? isAzureSql ? true : false;

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mssql = require('mssql');

        let pool: any;
        try {
            pool = await mssql.connect({
                server: cfg.host,
                port: cfg.port ?? 1433,
                user: cfg.user,
                password: cfg.password,
                database: cfg.database,
                options: {
                    encrypt,
                    trustServerCertificate: cfg.trustServerCertificate ?? false,
                    instanceName: cfg.instance,
                    domain: cfg.domain,
                },
                connectionTimeout: cfg.connectionTimeout ?? 15000,
                requestTimeout: cfg.requestTimeout ?? 30000,
                pool: { max: 1, min: 0, idleTimeoutMillis: 2000 },
            });
            await pool.request().query('SELECT 1 AS n');
            return { success: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        } finally {
            if (pool) {
                await pool.close().catch(() => { /* ignore */ });
            }
        }
    }

    // ── RFC-016 Schema Metadata ─────────────────────────────────────────────

    async listSchemas(
        config: ConnectorConfig,
    ): Promise<{ catalog?: string; schema: string }[]> {
        const rows = await this.runMetadataQuery(
            config as MSSQLConfig,
            `SELECT SCHEMA_NAME AS [schema]
             FROM INFORMATION_SCHEMA.SCHEMATA
             ORDER BY SCHEMA_NAME`,
        );
        return rows
            .filter((r: unknown[]) => !SYSTEM_SCHEMAS.has(String(r[0])))
            .map((r: unknown[]) => ({ schema: String(r[0]) }));
    }

    async listTables(
        config: ConnectorConfig,
        schema: string,
    ): Promise<{ catalog?: string; schema: string; name: string; type: string }[]> {
        const rows = await this.runMetadataQuery(
            config as MSSQLConfig,
            `SELECT TABLE_NAME,
                    CASE TABLE_TYPE WHEN 'BASE TABLE' THEN 'TABLE' ELSE TABLE_TYPE END AS table_type
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = @schema
             ORDER BY TABLE_NAME`,
            { schema },
        );
        return rows.map((r: unknown[]) => ({
            schema,
            name: String(r[0]),
            type: String(r[1]),
        }));
    }

    async describeTable(
        config: ConnectorConfig,
        table: string,
        schema: string,
    ): Promise<{
        table: { schema: string; name: string; type: string };
        columns: {
            name: string;
            type: string;
            nullable: boolean;
            ordinalPosition: number;
            defaultValue?: string;
            isPrimaryKey?: boolean;
        }[];
    }> {
        const cfg = config as MSSQLConfig;

        const pkRows = await this.runMetadataQuery(
            cfg,
            `SELECT kcu.COLUMN_NAME
             FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
             INNER JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
               ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
               AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
               AND tc.TABLE_NAME = kcu.TABLE_NAME
             WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
               AND kcu.TABLE_SCHEMA = @schema
               AND kcu.TABLE_NAME = @table`,
            { schema, table },
        );
        const primaryKeys = new Set(pkRows.map((r: unknown[]) => String(r[0])));

        const colRows = await this.runMetadataQuery(
            cfg,
            `SELECT COLUMN_NAME,
                    DATA_TYPE,
                    IS_NULLABLE,
                    ORDINAL_POSITION,
                    COLUMN_DEFAULT
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
             ORDER BY ORDINAL_POSITION`,
            { schema, table },
        );

        const columns = colRows.map((r: unknown[]) => ({
            name: String(r[0]),
            type: String(r[1]),
            nullable: String(r[2]) === 'YES',
            ordinalPosition: Number(r[3]),
            defaultValue: r[4] != null ? String(r[4]) : undefined,
            isPrimaryKey: primaryKeys.has(String(r[0])),
        }));

        return {
            table: { schema, name: table, type: 'TABLE' },
            columns,
        };
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    private async runMetadataQuery(
        cfg: MSSQLConfig,
        sql: string,
        params: Record<string, string> = {},
    ): Promise<unknown[][]> {
        const isAzureSql = cfg.host.toLowerCase().endsWith('.database.windows.net');
        const encrypt = cfg.ssl ?? isAzureSql ? true : false;

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mssql = require('mssql');
        const pool = await mssql.connect({
            server: cfg.host,
            port: cfg.port ?? 1433,
            user: cfg.user,
            password: cfg.password,
            database: cfg.database,
            options: {
                encrypt,
                trustServerCertificate: cfg.trustServerCertificate ?? false,
                instanceName: cfg.instance,
                domain: cfg.domain,
            },
            connectionTimeout: cfg.connectionTimeout ?? 15000,
            requestTimeout: cfg.requestTimeout ?? 15000,
            pool: { max: 1, min: 0, idleTimeoutMillis: 2000 },
        });

        try {
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(sql);
            const recordset: Record<string, unknown>[] = result.recordset ?? [];
            if (recordset.length === 0) return [];
            const keys = Object.keys(recordset[0]);
            return recordset.map(row => keys.map(k => row[k]));
        } finally {
            await pool.close().catch(() => { /* ignore */ });
        }
    }

    private handleError(err: unknown, query?: string): never {
        const e = err as Error & { code?: string; number?: number };
        const msg = e.message || String(err);
        const code = e.code ?? '';
        const number = e.number; // SQL Server error number (e.g. 18456 = login failed)

        // SQL Server error 18456: Login failed
        if (number === 18456) {
            throw new AuthenticationError(`Authentication failed: ${msg}`);
        }
        // Connection-level errors
        if (
            code === 'ECONNREFUSED' ||
            code === 'ENOTFOUND' ||
            code === 'ETIMEOUT' ||
            code === 'ESOCKET' ||
            code === 'ECONNRESET' ||
            msg.includes('Failed to connect') ||
            msg.includes('Could not connect')
        ) {
            throw new ConnectionError(`Connection failed: ${msg}`);
        }
        // Generic auth fallback
        if (
            msg.includes('Login failed') ||
            msg.includes('password') ||
            msg.includes('authentication')
        ) {
            throw new AuthenticationError(`Authentication failed: ${msg}`);
        }

        // SSL/TLS friendly guidance
        if (msg.includes('self-signed') || msg.includes('certificate')) {
            throw new ConnectionError(
                `SSL error: ${msg}. Tip: set trustServerCertificate: true for local/dev SQL Server instances.`,
            );
        }

        throw new QueryError(`Query failed: ${msg}`, query);
    }
}
