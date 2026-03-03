import { readFileSync } from 'fs';
import { createPrivateKey } from 'crypto';
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

export interface SnowflakeConfig extends ConnectorConfig {
    account: string;          // e.g. "myorg-myaccount"
    username: string;
    password?: string;        // mutually exclusive with privateKeyPath
    privateKeyPath?: string;  // absolute path to PEM private key file
    privateKeyPassphrase?: string;
    warehouse?: string;
    database?: string;
    schema?: string;
    role?: string;
    loginTimeout?: number;    // seconds, default: 60
    application?: string;     // reported to Snowflake, default: "sql-preview"
}

// ── Account identifier normalisation ────────────────────────────────────────
// Strip https://, .snowflakecomputing.com suffix, and trailing slashes.

function normaliseAccount(account: string): string {
    let a = account.trim();
    // Strip trailing slashes first so suffix checks work correctly
    a = a.replace(/\/+$/, '');
    if (a.startsWith('https://')) a = a.slice(8);
    if (a.startsWith('http://')) a = a.slice(7);
    // Strip trailing slashes again in case https:// left one
    a = a.replace(/\/+$/, '');
    if (a.endsWith('.snowflakecomputing.com')) {
        a = a.slice(0, -'.snowflakecomputing.com'.length);
    }
    return a;
}

// ── Type mapping ─────────────────────────────────────────────────────────────

function mapSnowflakeType(typeName: string): string {
    const t = typeName.toUpperCase();
    if (/^(NUMBER|DECIMAL|NUMERIC|INT|INTEGER|BIGINT|SMALLINT|TINYINT|BYTEINT)$/.test(t)) {
        return 'integer';
    }
    if (/^(FLOAT|FLOAT4|FLOAT8|DOUBLE|DOUBLE PRECISION|REAL)$/.test(t)) {
        return 'number';
    }
    if (/^TIMESTAMP/.test(t)) return 'timestamp';
    if (t === 'DATE') return 'date';
    if (t === 'BOOLEAN') return 'boolean';
    // VARIANT, OBJECT, ARRAY → string (JSON stringified by snowflake-sdk)
    return 'string';
}

// ── Promise wrappers for the callback-based snowflake-sdk API ────────────────

function connectAsync(connection: any): Promise<void> {
    return new Promise((resolve, reject) => {
        connection.connect((err: Error | undefined) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function executeAsync(
    connection: any,
    sqlText: string,
): Promise<{ rows: Record<string, unknown>[]; columns: { name: string; type: string }[] }> {
    return new Promise((resolve, reject) => {
        connection.execute({
            sqlText,
            fetchAsString: ['Date', 'JSON'],
            complete: (
                err: Error | undefined,
                _stmt: unknown,
                rows: Record<string, unknown>[] | undefined,
            ) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ rows: rows ?? [], columns: [] });
            },
        });
    });
}

function destroyAsync(connection: any): Promise<void> {
    return new Promise(resolve => {
        connection.destroy((_err: Error | undefined) => resolve());
    });
}

// ── System schemas excluded from listSchemas ─────────────────────────────────

const SNOWFLAKE_SYSTEM_SCHEMAS = new Set(['INFORMATION_SCHEMA']);

// ── Connector ────────────────────────────────────────────────────────────────

export default class SnowflakeConnector implements IConnector<ConnectorConfig> {
    readonly id = 'snowflake';
    readonly supportsPagination = false;

    // ── validateConfig ──────────────────────────────────────────────────────

    validateConfig(config: ConnectorConfig): string | undefined {
        const cfg = config as SnowflakeConfig;
        if (!cfg.account) return 'account is required';
        if (!cfg.username) return 'username is required';
        // warehouse is strongly recommended but non-fatal (some queries work without it)
        return undefined;
    }

    // ── Private: build connection options ───────────────────────────────────

    private buildConnectionOptions(cfg: SnowflakeConfig): Record<string, unknown> {
        const account = normaliseAccount(cfg.account);

        const opts: Record<string, unknown> = {
            account,
            username: cfg.username,
            warehouse: cfg.warehouse,
            database: cfg.database,
            schema: cfg.schema,
            role: cfg.role,
            loginTimeout: cfg.loginTimeout ?? 60,
            application: cfg.application ?? 'sql-preview',
        };

        if (cfg.privateKeyPath) {
            // Key pair authentication
            const keyContent = readFileSync(cfg.privateKeyPath, 'utf8');
            const pk = createPrivateKey({
                key: keyContent,
                passphrase: cfg.privateKeyPassphrase,
                format: 'pem',
            });
            opts['privateKey'] = pk.export({ type: 'pkcs8', format: 'pem' }).toString();
        } else {
            opts['password'] = cfg.password;
        }

        return opts;
    }

    // ── Private: create and connect ─────────────────────────────────────────

    private async createConnection(cfg: SnowflakeConfig): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const snowflake = require('snowflake-sdk');
        const connection = snowflake.createConnection(this.buildConnectionOptions(cfg));
        try {
            await connectAsync(connection);
        } catch (err) {
            this.handleError(err);
        }
        return connection;
    }

    // ── runQuery ────────────────────────────────────────────────────────────

    async *runQuery(
        query: string,
        config: ConnectorConfig,
        _authHeader?: string,
        abortSignal?: AbortSignal,
    ): AsyncGenerator<QueryPage, void, unknown> {
        const cfg = config as SnowflakeConfig;
        const connection = await this.createConnection(cfg);

        try {
            if (abortSignal?.aborted) return;

            let result: { rows: Record<string, unknown>[]; columns: { name: string; type: string }[] };
            try {
                result = await executeAsync(connection, query);
            } catch (err) {
                this.handleError(err, query);
            }

            if (abortSignal?.aborted) return;

            const { rows } = result!;

            // Build columns from the first row's keys (snowflake-sdk returns objects)
            const columns: ColumnDef[] =
                rows.length > 0
                    ? Object.keys(rows[0]).map(name => ({
                        name,
                        type: inferTypeFromValue(rows[0][name]),
                    }))
                    : [];

            const data: unknown[][] = rows.map(row => columns.map(c => row[c.name]));

            yield {
                columns,
                data,
                stats: { state: 'FINISHED', rowCount: rows.length },
            };
        } finally {
            await destroyAsync(connection);
        }
    }

    // ── testConnection ──────────────────────────────────────────────────────

    async testConnection(
        config: ConnectorConfig,
    ): Promise<{ success: boolean; error?: string }> {
        const cfg = config as SnowflakeConfig;
        let connection: any;
        try {
            connection = await this.createConnection(cfg);
            await executeAsync(connection, 'SELECT CURRENT_TIMESTAMP()');
            return { success: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        } finally {
            if (connection) await destroyAsync(connection);
        }
    }

    // ── RFC-016 Schema Metadata ─────────────────────────────────────────────

    async listSchemas(
        config: ConnectorConfig,
    ): Promise<{ catalog?: string; schema: string }[]> {
        const cfg = config as SnowflakeConfig;
        const rows = await this.runMetadataQuery(
            cfg,
            `SELECT SCHEMA_NAME AS "schema"
             FROM INFORMATION_SCHEMA.SCHEMATA
             WHERE SCHEMA_NAME != 'INFORMATION_SCHEMA'
             ORDER BY SCHEMA_NAME`,
        );
        return rows
            .filter(r => !SNOWFLAKE_SYSTEM_SCHEMAS.has(String(r[0])))
            .map(r => ({ catalog: cfg.database, schema: String(r[0]) }));
    }

    async listTables(
        config: ConnectorConfig,
        schema: string,
    ): Promise<{ catalog?: string; schema: string; name: string; type: string; comment?: string }[]> {
        const cfg = config as SnowflakeConfig;
        const rows = await this.runMetadataQuery(
            cfg,
            `SELECT TABLE_NAME, TABLE_TYPE, COMMENT
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = '${escapeSingleQuote(schema)}'
             ORDER BY TABLE_NAME`,
        );
        return rows.map(r => ({
            catalog: cfg.database,
            schema,
            name: String(r[0]),
            type: String(r[1]),
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
            name: string;
            type: string;
            nullable: boolean;
            ordinalPosition: number;
            defaultValue?: string;
            comment?: string;
            isPrimaryKey?: boolean;
        }[];
    }> {
        const cfg = config as SnowflakeConfig;

        // Get primary keys via SHOW PRIMARY KEYS — gracefully skip on failure
        let primaryKeys = new Set<string>();
        try {
            const pkRows = await this.runMetadataQuery(
                cfg,
                `SHOW PRIMARY KEYS IN TABLE "${escapeDblQuote(schema)}"."${escapeDblQuote(table)}"`,
            );
            // SHOW PRIMARY KEYS result: column_name is at index 4
            primaryKeys = new Set(pkRows.map(r => String(r[4])));
        } catch {
            // Skip primary key detection if privilege is insufficient
        }

        const colRows = await this.runMetadataQuery(
            cfg,
            `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
                    ORDINAL_POSITION, COLUMN_DEFAULT, COMMENT
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = '${escapeSingleQuote(schema)}'
               AND TABLE_NAME = '${escapeSingleQuote(table)}'
             ORDER BY ORDINAL_POSITION`,
        );

        return {
            table: { schema, name: table, type: 'TABLE' },
            columns: colRows.map(r => ({
                name: String(r[0]),
                type: mapSnowflakeType(String(r[1])),
                nullable: String(r[2]) === 'YES',
                ordinalPosition: Number(r[3]),
                defaultValue: r[4] != null ? String(r[4]) : undefined,
                comment: r[5] ? String(r[5]) : undefined,
                isPrimaryKey: primaryKeys.has(String(r[0])),
            })),
        };
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    private async runMetadataQuery(cfg: SnowflakeConfig, sql: string): Promise<unknown[][]> {
        const connection = await this.createConnection(cfg);
        try {
            const { rows } = await executeAsync(connection, sql);
            if (rows.length === 0) return [];
            const keys = Object.keys(rows[0]);
            return rows.map(row => keys.map(k => row[k]));
        } finally {
            await destroyAsync(connection);
        }
    }

    private handleError(err: unknown, query?: string): never {
        const e = err as Error & { code?: number | string; sqlState?: string };
        const msg = e.message || String(err);
        const code = typeof e.code === 'number' ? e.code : undefined;

        // Snowflake error codes: 390100 = wrong password, 390001 = user locked
        if (code === 390100 || code === 390001 || msg.includes('Incorrect username or password')) {
            throw new AuthenticationError(`Authentication failed: ${msg}`);
        }
        // Generic auth fallback
        if (
            msg.toLowerCase().includes('login') ||
            msg.toLowerCase().includes('password incorrect') ||
            msg.toLowerCase().includes('user account is locked')
        ) {
            throw new AuthenticationError(`Authentication failed: ${msg}`);
        }
        // Network errors
        if (
            msg.includes('ECONNREFUSED') ||
            msg.includes('ENOTFOUND') ||
            msg.includes('ETIMEDOUT') ||
            msg.includes('Failed to connect') ||
            msg.includes('Unable to connect')
        ) {
            throw new ConnectionError(`Connection failed: ${msg}`);
        }

        throw new QueryError(`Query failed: ${msg}`, query);
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferTypeFromValue(value: unknown): string {
    if (value === null || value === undefined) return 'string';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') {
        return Number.isInteger(value) ? 'integer' : 'number';
    }
    if (value instanceof Date) return 'timestamp';
    // fetchAsString: ['Date','JSON'] means dates come back as strings, not Date objects
    // We keep them as 'string' in the column def; the display layer handles formatting
    return 'string';
}

function escapeSingleQuote(s: string): string {
    return s.replace(/'/g, "''");
}

function escapeDblQuote(s: string): string {
    return s.replace(/"/g, '""');
}
