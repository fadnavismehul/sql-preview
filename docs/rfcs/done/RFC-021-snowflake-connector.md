# RFC-021: Snowflake Connector

**Status:** Proposed  
**Created:** 2026-03-02  
**Owner:** Core Team  
**Related RFCs:** RFC-012 (Pluggable Connectors), RFC-013 (Agentic MCP Connectors), RFC-016 (Schema Metadata API)

## Goal

Add a Snowflake connector to SQL Preview as `packages/sql-preview-snowflake`, enabling MCP agents to query Snowflake data warehouses — the most widely adopted cloud data platform in analytics-forward enterprises (~30% share and growing).

## Problem Statement

Snowflake is the primary query target for AI-assisted analytics. Data teams using Claude, Cursor, or similar tools against Snowflake represent SQL Preview's highest-value segment. Snowflake's web UI (Snowsight) is the current workflow; SQL Preview offers richer MCP integration with agents that Snowsight cannot provide.

Snowflake has its own authentication model (account identifier, warehouse, role) that does not map 1:1 to host/port patterns used by Postgres/MySQL, requiring thoughtful profile field design.

## Scope

**In Scope:**

- `packages/sql-preview-snowflake/` implementing `IConnector`
- `runQuery` via `snowflake-sdk`; full result buffering
- `testConnection` via a lightweight `SHOW WAREHOUSES` or `SELECT CURRENT_TIMESTAMP()`
- `validateConfig`: account, username, warehouse required; database, schema, role optional
- Schema metadata (RFC-016): `listSchemas`, `listTables`, `describeTable` using Snowflake `INFORMATION_SCHEMA`
- Connection profile type: `snowflake`
- Auth methods:
  - **Username + Password** (default, v1)
  - **Key Pair authentication** (private key file path, v1)
- CLI entrypoint, unit tests, README

**Out of Scope:**

- OAuth / browser-based SSO (requires interactive redirect, future RFC)
- External OAuth tokens (Okta, Azure AD for Snowflake) — future RFC
- Snowpark / Python UDFs
- Time Travel queries (supported transparently via `runQuery`)
- Snowflake Cortex AI functions (no special handling needed)

## Proposal

### Driver

Use [`snowflake-sdk`](https://www.npmjs.com/package/snowflake-sdk) — the official Snowflake Node.js driver. It is pure JS (no native bindings required for username/password auth).

> **Important:** `snowflake-sdk` uses a callback-based API. Wrap with a Promise adapter.

### Connection Profile Shape

```typescript
interface SnowflakeConnectionProfile extends BaseConnectionProfile {
  type: 'snowflake';
  account: string; // e.g. "myorg-myaccount" (format: org-account)
  username: string;
  password?: string; // from ICredentialStore; mutually exclusive with privateKey
  privateKeyPath?: string; // absolute path to PEM-encoded private key file
  privateKeyPassphrase?: string; // if private key is encrypted
  warehouse?: string; // compute warehouse, e.g. "COMPUTE_WH"
  database?: string; // optional; can be specified in query
  schema?: string; // optional default schema
  role?: string; // e.g. "SYSADMIN", "ANALYST"
  loginTimeout?: number; // seconds, default: 60
  application?: string; // identifies the client to Snowflake, default: "sql-preview"
}
```

### Account Identifier Resolution

Snowflake uses account identifiers in the format `<org>-<account>`, translating to `<account>.snowflakecomputing.com`. Validate that `account` does not include `https://` or `.snowflakecomputing.com` (strip if present and document clearly).

### `runQuery` Implementation

```typescript
async *runQuery(query: string, config: ConnectorConfig): AsyncGenerator<QueryPage> {
  const cfg = config as SnowflakeConnectionProfile;
  const snowflake = await import('snowflake-sdk');

  const connectionOptions: snowflake.ConnectionOptions = {
    account: cfg.account,
    username: cfg.username,
    password: cfg.password,
    privateKeyPath: cfg.privateKeyPath,
    privateKeyPass: cfg.privateKeyPassphrase,
    warehouse: cfg.warehouse,
    database: cfg.database,
    schema: cfg.schema,
    role: cfg.role,
    loginTimeout: cfg.loginTimeout ?? 60,
    application: cfg.application ?? 'sql-preview',
  };

  const connection = snowflake.createConnection(connectionOptions);

  await new Promise<void>((resolve, reject) =>
    connection.connect((err) => err ? reject(err) : resolve())
  );

  try {
    const rows: Record<string, unknown>[] = await new Promise((resolve, reject) =>
      connection.execute({
        sqlText: query,
        fetchAsString: ['Date', 'JSON'],
        complete: (err, stmt, rows) => err ? reject(err) : resolve(rows ?? []),
      })
    );

    const columns: ColumnDef[] = rows.length > 0
      ? Object.keys(rows[0]).map(name => ({ name, type: inferSnowflakeType(rows[0][name]) }))
      : [];
    const data = rows.map(row => columns.map(c => row[c.name]));

    yield { columns, data, stats: { state: 'FINISHED', rowCount: rows.length } };
  } finally {
    await new Promise<void>((resolve) => connection.destroy((_err) => resolve()));
  }
}
```

### Authentication: Key Pair

For key pair auth, load the PEM file at connection time:

```typescript
import { readFileSync } from 'fs';
import { createPrivateKey } from 'crypto';

const pk = createPrivateKey({
  key: readFileSync(cfg.privateKeyPath, 'utf8'),
  passphrase: cfg.privateKeyPassphrase,
  format: 'pem',
});
const privateKeyString = pk.export({ type: 'pkcs8', format: 'pem' }).toString();
// pass as `privateKey` to connection options
```

### Schema Metadata (RFC-016)

Snowflake's `INFORMATION_SCHEMA` follows the SQL standard:

```sql
-- listSchemas (within the connected database)
SELECT SCHEMA_NAME AS schema
FROM INFORMATION_SCHEMA.SCHEMATA
WHERE SCHEMA_NAME != 'INFORMATION_SCHEMA'
ORDER BY SCHEMA_NAME;

-- listTables(schema)
SELECT TABLE_NAME AS name, TABLE_TYPE AS type,
       COMMENT AS comment
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = :schema
ORDER BY TABLE_NAME;

-- describeTable(table, schema)
SELECT COLUMN_NAME AS name,
       DATA_TYPE AS type,
       CASE IS_NULLABLE WHEN 'YES' THEN true ELSE false END AS nullable,
       ORDINAL_POSITION AS ordinalPosition,
       COLUMN_DEFAULT AS defaultValue,
       COMMENT AS comment
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table
ORDER BY ORDINAL_POSITION;
```

For primary key detection: `SHOW PRIMARY KEYS IN TABLE <schema>.<table>` (Snowflake-specific command).

Multi-catalog: if `database` is not specified in the profile, `listSchemas` should run `SHOW DATABASES` first and return `{catalog, schema}` pairs using the Snowflake three-level namespace.

### Type Mapping

| Snowflake type                                                                                                                              | SQL Preview type                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `NUMBER`, `DECIMAL`, `NUMERIC`, `INT`, `INTEGER`, `BIGINT`, `SMALLINT`, `TINYINT`, `BYTEINT`, `FLOAT`, `FLOAT4`, `FLOAT8`, `DOUBLE`, `REAL` | `number` or `integer` per precision |
| `TIMESTAMP_NTZ`, `TIMESTAMP_LTZ`, `TIMESTAMP_TZ`                                                                                            | `timestamp`                         |
| `DATE`                                                                                                                                      | `date`                              |
| `TIME`                                                                                                                                      | `string`                            |
| `BOOLEAN`                                                                                                                                   | `boolean`                           |
| `VARIANT`, `OBJECT`, `ARRAY`                                                                                                                | `string` (JSON stringified)         |
| All `VARCHAR`, `CHAR`, `STRING`, `TEXT`, `BINARY`                                                                                           | `string`                            |

### Error Classification

| Snowflake error                      | SQL Preview class     |
| ------------------------------------ | --------------------- |
| 390100 (incorrect username/password) | `AuthenticationError` |
| 390001 (user is locked)              | `AuthenticationError` |
| Network / ECONNREFUSED               | `ConnectionError`     |
| SQL compilation errors (002003 etc.) | `QueryError`          |

## Implementation Plan

1. Create `packages/sql-preview-snowflake/`
2. Implement `SnowflakeConnector`:
   - `validateConfig`, `testConnection` (`SELECT CURRENT_TIMESTAMP()`), `runQuery`
   - Key pair auth support
3. Implement `src/cli.ts`
4. Add `snowflake` to type union in `src/common/types.ts`
5. Register in `DriverManager` / `ConnectorRegistry`
6. Implement RFC-016 metadata methods (including `SHOW PRIMARY KEYS`)
7. Write unit tests (mock `snowflake-sdk` connection)
8. Integration test: connect to a Snowflake trial account (available free at signup), run `SELECT CURRENT_ACCOUNT()`
9. Add to Connections form in RFC-018

## Acceptance Criteria

1. `validateConfig` rejects missing `account` or `username`; warns if `warehouse` is missing (non-fatal)
2. Account identifier normalisation: `https://myorg-myaccount.snowflakecomputing.com` → `myorg-myaccount`
3. `runQuery('SELECT CURRENT_TIMESTAMP()')` returns one row with `fetchAsString: ['Date']` applied
4. Key pair auth: providing `privateKeyPath` to a valid PEM file connects successfully (no password needed)
5. `listSchemas` returns user-visible schemas in the connected database (excludes `INFORMATION_SCHEMA`)
6. `listTables` returns TABLE and VIEW rows with type labels
7. Error 390100 is surfaced as `AuthenticationError`, not a generic crash
8. `npm run build` produces `dist/index.js` with `snowflake-sdk` marked external (installed separately)

## Risks and Mitigations

| Risk                                                        | Likelihood | Mitigation                                                                                           |
| ----------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `snowflake-sdk` callback API is verbose and error-prone     | Medium     | Wrap all callbacks in thin Promise utilities; test each wrapper                                      |
| Snowflake account identifier format is confusing for users  | High       | Validate and strip common URL prefixes; display example in profile form                              |
| `SHOW PRIMARY KEYS` requires `INFORMATION_SCHEMA` privilege | Low        | Gracefully skip `isPrimaryKey` if the call fails; do not propagate the error                         |
| `snowflake-sdk` bundle size is large (~10 MB uncompressed)  | Medium     | Mark as `--external` in esbuild; user installs via DriverManager or `npm install` in the package dir |

## Rollout and Backout

**Rollout:** New package only. Additive.

**Backout:** Remove package directory and `snowflake` from the type union.

## Open Questions

1. Should we support the Snowflake OAuth PKCE flow in v1? Decision: No — too complex, requires a browser redirect. Add in a future RFC covering cloud-provider auth flows.
2. Should `SHOW WAREHOUSES` be used for `testConnection` instead of `SELECT CURRENT_TIMESTAMP()`? Decision: `SELECT CURRENT_TIMESTAMP()` is lighter and works even without warehouse access.
3. Should the connector support Snowflake Private Link endpoints (custom hostnames)? Decision: Yes — the `account` field naturally supports any account identifier string, including custom private link hostnames.
