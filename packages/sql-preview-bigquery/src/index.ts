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

export interface BigQueryConfig extends ConnectorConfig {
    projectId: string;
    location?: string;   // default: 'US'
    dataset?: string;    // default dataset for queries
    keyFilename?: string;
    credentials?: {
        client_email: string;
        private_key: string;
    };
    maximumBytesBilled?: number | null; // null = unlimited
    timeoutMs?: number;  // default: 60000
}

// ── Type mapping ─────────────────────────────────────────────────────────────
// Maps BigQuery field types (from metadata.schema.fields) to SQL Preview types.

function mapBigQueryFieldType(bqType: string): string {
    const t = bqType.toUpperCase();
    switch (t) {
        case 'INT64':
        case 'INTEGER':
        case 'NUMERIC':
        case 'BIGNUMERIC':
            return 'integer';
        case 'FLOAT64':
        case 'FLOAT':
            return 'number';
        case 'TIMESTAMP':
        case 'DATETIME':
            return 'timestamp';
        case 'DATE':
            return 'date';
        case 'BOOL':
        case 'BOOLEAN':
            return 'boolean';
        default:
            // STRING, BYTES, TIME, JSON, GEOGRAPHY, STRUCT, RECORD, ARRAY, etc.
            return 'string';
    }
}

// Infer type from a JS runtime value (used for runQuery column detection)
function inferTypeFromValue(value: unknown): string {
    if (value === null || value === undefined) return 'string';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    if (value instanceof Date) return 'timestamp';
    if (typeof value === 'object') return 'string'; // STRUCT / RECORD / ARRAY
    return 'string';
}

// ── Connector ────────────────────────────────────────────────────────────────

export default class BigQueryConnector implements IConnector<ConnectorConfig> {
    readonly id = 'bigquery';
    readonly supportsPagination = false;

    // ── validateConfig ──────────────────────────────────────────────────────

    validateConfig(config: ConnectorConfig): string | undefined {
        const cfg = config as BigQueryConfig;
        if (!cfg.projectId) return 'projectId is required';
        return undefined;
    }

    // ── Private: create BigQuery client ────────────────────────────────────

    private createClient(cfg: BigQueryConfig): any {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { BigQuery } = require('@google-cloud/bigquery');
        const opts: Record<string, unknown> = {
            projectId: cfg.projectId,
            location: cfg.location ?? 'US',
        };
        if (cfg.credentials) {
            opts['credentials'] = cfg.credentials;
        } else if (cfg.keyFilename) {
            opts['keyFilename'] = cfg.keyFilename;
        }
        // If neither credentials nor keyFilename provided → Application Default Credentials
        return new BigQuery(opts);
    }

    // ── runQuery ────────────────────────────────────────────────────────────

    async *runQuery(
        query: string,
        config: ConnectorConfig,
        _authHeader?: string,
        abortSignal?: AbortSignal,
    ): AsyncGenerator<QueryPage, void, unknown> {
        const cfg = config as BigQueryConfig;

        if (abortSignal?.aborted) return;

        const bq = this.createClient(cfg);

        const queryOptions: Record<string, unknown> = {
            query,
            location: cfg.location ?? 'US',
            timeoutMs: cfg.timeoutMs ?? 60000,
        };

        if (cfg.maximumBytesBilled != null) {
            queryOptions['maximumBytesBilled'] = String(cfg.maximumBytesBilled);
        }
        if (cfg.dataset) {
            queryOptions['defaultDataset'] = {
                datasetId: cfg.dataset,
                projectId: cfg.projectId,
            };
        }

        let rows: Record<string, unknown>[];
        try {
            const [result] = await bq.query(queryOptions);
            rows = result as Record<string, unknown>[];
        } catch (err) {
            this.handleError(err, query, cfg);
        }

        if (abortSignal?.aborted) return;

        if (rows!.length === 0) {
            yield { columns: [], data: [], stats: { state: 'FINISHED', rowCount: 0 } };
            return;
        }

        const columns: ColumnDef[] = Object.keys(rows![0]).map(name => ({
            name,
            type: inferTypeFromValue(rows![0][name]),
        }));
        const data: unknown[][] = rows!.map(row => columns.map(c => row[c.name]));

        yield { columns, data, stats: { state: 'FINISHED', rowCount: rows!.length } };
    }

    // ── testConnection ──────────────────────────────────────────────────────

    async testConnection(
        config: ConnectorConfig,
    ): Promise<{ success: boolean; error?: string }> {
        const cfg = config as BigQueryConfig;
        try {
            const bq = this.createClient(cfg);
            // Lightweight check — just list at most 1 dataset
            await bq.getDatasets({ maxResults: 1 });
            return { success: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    }

    // ── RFC-016 Schema Metadata ─────────────────────────────────────────────

    async listSchemas(
        config: ConnectorConfig,
    ): Promise<{ catalog?: string; schema: string }[]> {
        const cfg = config as BigQueryConfig;
        const bq = this.createClient(cfg);
        try {
            const [datasets] = await bq.getDatasets();
            return (datasets as any[]).map((ds: any) => ({
                catalog: cfg.projectId,
                schema: ds.id as string,
            }));
        } catch (err) {
            this.handleError(err);
        }
    }

    async listTables(
        config: ConnectorConfig,
        schema: string,
    ): Promise<{ catalog?: string; schema: string; name: string; type: string }[]> {
        const cfg = config as BigQueryConfig;
        const bq = this.createClient(cfg);
        try {
            const [tables] = await bq.dataset(schema).getTables();
            return (tables as any[]).map((t: any) => ({
                catalog: cfg.projectId,
                schema,
                name: t.id as string,
                type: t.metadata?.type === 'VIEW' ? 'VIEW' : 'TABLE',
            }));
        } catch (err) {
            this.handleError(err);
        }
    }

    async describeTable(
        config: ConnectorConfig,
        table: string,
        schema: string,
    ): Promise<{
        table: { catalog?: string; schema: string; name: string; type: string };
        columns: {
            name: string;
            type: string;
            nullable: boolean;
            ordinalPosition: number;
            description?: string;
        }[];
    }> {
        const cfg = config as BigQueryConfig;
        const bq = this.createClient(cfg);
        try {
            const [metadata] = await bq.dataset(schema).table(table).getMetadata();
            const fields: any[] = metadata.schema?.fields ?? [];
            return {
                table: { catalog: cfg.projectId, schema, name: table, type: 'TABLE' },
                columns: fields.map((f: any, i: number) => ({
                    name: f.name,
                    type: mapBigQueryFieldType(f.type ?? ''),
                    nullable: f.mode !== 'REQUIRED',
                    ordinalPosition: i + 1,
                    description: f.description ?? undefined,
                })),
            };
        } catch (err) {
            this.handleError(err);
        }
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    private handleError(err: unknown, query?: string, _cfg?: BigQueryConfig): never {
        const e = err as Error & {
            code?: number;
            errors?: Array<{ reason?: string; message?: string }>;
        };
        const msg = e.message || String(err);
        const code = e.code;
        const reason = e.errors?.[0]?.reason ?? '';

        // HTTP 401 / 403 → auth error
        if (code === 401 || code === 403) {
            throw new AuthenticationError(
                `BigQuery authentication failed (HTTP ${code}): ${msg}. ` +
                'Check your credentials or run: gcloud auth application-default login',
            );
        }

        // quotaExceeded
        if (reason === 'quotaExceeded') {
            throw new QueryError(`BigQuery quota exceeded: ${msg}`, query);
        }

        // bytesBilledLimitExceeded (maximumBytesBilled guard)
        if (
            reason === 'bytesBilledLimitExceeded' ||
            msg.includes('bytesBilledLimitExceeded') ||
            msg.includes('Response too large to return')
        ) {
            throw new QueryError(
                `Query refused: would scan more data than the maximumBytesBilled limit set in your profile. ` +
                `Set maximumBytesBilled: null to allow unlimited scanning (charges apply). Details: ${msg}`,
                query,
            );
        }

        // Location mismatch — very common BigQuery gotcha
        if (msg.includes('Not found') && msg.includes('location')) {
            throw new QueryError(
                `BigQuery location mismatch: ${msg}. ` +
                'Ensure the "location" field in your profile matches your dataset region (e.g. "US", "EU", "us-central1").',
                query,
            );
        }

        // Network errors
        if (
            msg.includes('ECONNREFUSED') ||
            msg.includes('ENOTFOUND') ||
            msg.includes('ETIMEDOUT') ||
            msg.includes('network')
        ) {
            throw new ConnectionError(`BigQuery connection failed: ${msg}`);
        }

        throw new QueryError(`BigQuery query failed: ${msg}`, query);
    }
}
