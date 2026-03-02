# RFC-022: BigQuery Connector

**Status:** Proposed  
**Created:** 2026-03-02  
**Owner:** Core Team  
**Related RFCs:** RFC-012 (Pluggable Connectors), RFC-013 (Agentic MCP Connectors), RFC-016 (Schema Metadata API)

## Goal

Add a Google BigQuery connector to SQL Preview as `packages/sql-preview-bigquery`, enabling MCP agents to query BigQuery — Google's serverless data warehouse, used by ~25% of enterprise analytics teams and dominant in GCP-stack organisations.

## Problem Statement

BigQuery is architecturally distinct from the connectors added so far:

1. **No traditional host/port** — queries are sent to the BigQuery REST API over HTTPS
2. **Authentication** is GCP-based (Application Default Credentials, service account JSON, or OAuth)
3. **Three-level namespace**: project → dataset → table (analogous to catalog → schema → table)
4. **Billing is per byte scanned** — the connector must signal to users when a query may scan large volumes of data

These differences require a carefully designed profile schema and auth flow, but the `IConnector` abstraction handles it cleanly since all interactions go through `runQuery` and metadata methods.

## Scope

**In Scope:**

- `packages/sql-preview-bigquery/` implementing `IConnector`
- `runQuery` via `@google-cloud/bigquery`; async result buffering
- `testConnection` via `bigquery.getDatasets()` with limit 1
- `validateConfig`: `projectId` required; `keyFilename` or ADC required for auth
- Schema metadata (RFC-016): `listSchemas` (= datasets), `listTables` (within a dataset), `describeTable`
- Auth methods:
  - **Application Default Credentials (ADC)** — `gcloud auth application-default login` (default)
  - **Service Account JSON file** — `keyFilename` path in profile
  - **Service Account JSON inline** — `credentials` JSON object in profile (for headless/CI)
- Connection profile type: `bigquery`
- BigQuery ML, BI Engine, partitioned tables — supported transparently via SQL
- CLI entrypoint, unit tests, README

**Out of Scope:**

- OAuth browser flow (requires interactive redirect)
- Workload Identity Federation
- Streaming inserts / DML `INSERT INTO` support (supported by `runQuery` transparently, but not officially in scope)
- Cost estimation / dry run before execution (nice to have, future RFC)
- Multi-region routing (automatically handled by BigQuery API)

## Proposal

### Driver

Use [`@google-cloud/bigquery`](https://www.npmjs.com/package/@google-cloud/bigquery) — the official Google Cloud client library. Pure JavaScript, no native bindings.

### Connection Profile Shape

```typescript
interface BigQueryConnectionProfile extends BaseConnectionProfile {
  type: 'bigquery';
  projectId: string; // GCP project ID, e.g. "my-company-prod"
  location?: string; // BigQuery location, e.g. "US", "EU", "us-central1"
  dataset?: string; // default dataset for queries without explicit schema
  keyFilename?: string; // absolute path to service account JSON key file
  credentials?: {
    // inline service account JSON (for env-based / headless)
    client_email: string;
    private_key: string;
  };
  maximumBytesBilled?: number; // bytes, e.g. 10_000_000_000 (10 GB); null = unlimited
  timeoutMs?: number; // job timeout, default: 60000
}
```

> **Auth priority**: `credentials` > `keyFilename` > Application Default Credentials.
>
> **Security note**: `credentials.private_key` and `keyFilename` contain secrets. The `ICredentialStore` manages the `private_key` value; `keyFilename` is a path stored in the profile (the file itself is managed by the user).

### `runQuery` Implementation

BigQuery uses a job-based model. The client library hides this behind `query()`:

```typescript
async *runQuery(query: string, config: ConnectorConfig): AsyncGenerator<QueryPage> {
  const cfg = config as BigQueryConnectionProfile;
  const { BigQuery } = await import('@google-cloud/bigquery');

  const bq = new BigQuery({
    projectId: cfg.projectId,
    location: cfg.location ?? 'US',
    keyFilename: cfg.keyFilename,
    credentials: cfg.credentials
      ? { client_email: cfg.credentials.client_email, private_key: cfg.credentials.private_key }
      : undefined,
  });

  const queryOptions: BigQueryQueryOptions = {
    query,
    location: cfg.location ?? 'US',
    maximumBytesBilled: cfg.maximumBytesBilled?.toString(),
    timeoutMs: cfg.timeoutMs ?? 60000,
    defaultDataset: cfg.dataset ? { datasetId: cfg.dataset, projectId: cfg.projectId } : undefined,
  };

  const [rows] = await bq.query(queryOptions);

  if (rows.length === 0) {
    yield { columns: [], data: [], stats: { state: 'FINISHED', rowCount: 0 } };
    return;
  }

  const columns: ColumnDef[] = Object.keys(rows[0]).map(name => ({
    name,
    type: inferBigQueryType(rows[0][name]),
  }));
  const data = rows.map(row => columns.map(c => row[c.name]));

  yield { columns, data, stats: { state: 'FINISHED', rowCount: rows.length } };
}
```

### Type Mapping

| BigQuery type                               | SQL Preview type            |
| ------------------------------------------- | --------------------------- |
| `INT64`, `INTEGER`, `NUMERIC`, `BIGNUMERIC` | `integer` / `number`        |
| `FLOAT64`, `FLOAT`                          | `number`                    |
| `TIMESTAMP`, `DATETIME`                     | `timestamp`                 |
| `DATE`                                      | `date`                      |
| `TIME`                                      | `string`                    |
| `BOOL`, `BOOLEAN`                           | `boolean`                   |
| `STRUCT`, `RECORD`                          | `string` (JSON stringified) |
| `ARRAY`                                     | `string` (JSON stringified) |
| `STRING`, `BYTES`, `JSON`, `GEOGRAPHY`      | `string`                    |

### Schema Metadata (RFC-016)

BigQuery uses a three-level namespace. "Schema" maps to "dataset":

```typescript
// listSchemas — returns datasets in the project
async listSchemas(config: BigQueryConnectionProfile): Promise<SchemaInfo[]> {
  const [datasets] = await bq.getDatasets();
  return datasets.map(ds => ({ catalog: cfg.projectId, schema: ds.id! }));
}

// listTables(schema = datasetId)
async listTables(config, schema): Promise<TableInfo[]> {
  const [tables] = await bq.dataset(schema).getTables();
  return tables.map(t => ({
    catalog: cfg.projectId,
    schema,
    name: t.id!,
    type: t.metadata.type === 'VIEW' ? 'VIEW' : 'TABLE',
  }));
}

// describeTable
async describeTable(config, table, schema): Promise<TableDetail> {
  const [metadata] = await bq.dataset(schema).table(table).getMetadata();
  const columns: ColumnInfo[] = metadata.schema.fields.map((f: any, i: number) => ({
    name: f.name,
    type: f.type,
    nullable: f.mode !== 'REQUIRED',
    ordinalPosition: i + 1,
    description: f.description,
  }));
  return { table: { catalog: cfg.projectId, schema, name: table, type: 'TABLE' }, columns };
}
```

### Error Classification

| BigQuery error              | SQL Preview class                                               |
| --------------------------- | --------------------------------------------------------------- |
| 401, 403 (auth/permissions) | `AuthenticationError`                                           |
| quotaExceeded               | `QueryError` with "BigQuery quota exceeded" message             |
| bytesBilledLimitExceeded    | `QueryError` with "Query would exceed maximumBytesBilled limit" |
| Network errors              | `ConnectionError`                                               |
| SQL syntax errors           | `QueryError`                                                    |

### Cost Guard

When `maximumBytesBilled` is set, BigQuery rejects queries that would scan more than that amount. Surface this as a `QueryError` with a user-friendly message:

```
Query refused: would scan 150 GB, exceeding the 10 GB limit set in your connection profile.
Set maximumBytesBilled: null in your profile to allow unlimited scanning (charges apply).
```

## Implementation Plan

1. Create `packages/sql-preview-bigquery/`
2. Implement `BigQueryConnector`:
   - Auth resolution (credentials → keyFilename → ADC)
   - `validateConfig`, `testConnection`, `runQuery`
   - `maximumBytesBilled` cost guard
3. Implement `src/cli.ts`
4. Add `bigquery` to the type union in `src/common/types.ts`
5. Register in `DriverManager` / `ConnectorRegistry`
6. Implement RFC-016 metadata methods using BigQuery client API (not SQL — more reliable)
7. Write unit tests mocking `@google-cloud/bigquery`
8. Integration test against the BigQuery sandbox (free tier, `bigquery-public-data` project)
9. Add to Connections form in RFC-018; include ADC explanation for users unfamiliar with GCP auth

## Acceptance Criteria

1. `validateConfig` rejects a profile missing `projectId`
2. ADC auth: `runQuery('SELECT 1', config)` works when `gcloud auth application-default login` has been run (no `keyFilename` or `credentials` needed)
3. Service account JSON: providing `keyFilename` pointing to a valid key file connects and queries successfully
4. `maximumBytesBilled: 1` causes a `QueryError` with the overage message (not an unhandled exception)
5. `listSchemas` returns all datasets in the project the service account can see
6. `listTables('my_dataset')` returns tables and views with correct type labels
7. `describeTable('users', 'my_dataset')` returns field names, types, and nullability
8. All unit tests pass

## Risks and Mitigations

| Risk                                              | Likelihood | Mitigation                                                                                     |
| ------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| ADC setup is opaque for non-GCP users             | High       | README must include the exact `gcloud` command; profile form should show a link to GCP docs    |
| `@google-cloud/bigquery` bundle is large (~15 MB) | Medium     | Mark as `--external` in esbuild; installed via DriverManager                                   |
| BigQuery free tier quotas may affect CI tests     | Low        | Use `bigquery-public-data` which has no cost; add `maximumBytesBilled: 1000000` in CI config   |
| Private key must be stored securely               | High       | `credentials.private_key` must flow through `ICredentialStore`; never written to `config.json` |

## Rollout and Backout

**Rollout:** New package only. Additive.

**Backout:** Remove package directory and `bigquery` from the type union.

## Open Questions

1. Should the profile support multiple GCP projects (cross-project queries)? Decision: No — BigQuery's SQL already supports cross-project syntax (`project.dataset.table`). Users specify the billing project in the profile; cross-project reads happen in SQL.
2. Should `location` default to `US` or be required? Decision: Default to `US` but document that EU/regional datasets will fail if the wrong location is set. Surface a helpful error if location mismatch occurs.
3. Should we surface estimated bytes billed in the query results toolbar? Decision: Yes — BigQuery's job stats expose this. Add `bytesProcessed` to `QueryPage.stats` in a follow-up.
