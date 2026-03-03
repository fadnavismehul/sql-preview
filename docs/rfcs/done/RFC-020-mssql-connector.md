# RFC-020: SQL Server (MSSQL) Connector

**Status:** Proposed  
**Created:** 2026-03-02  
**Owner:** Core Team  
**Related RFCs:** RFC-012 (Pluggable Connectors), RFC-013 (Agentic MCP Connectors), RFC-016 (Schema Metadata API)

## Goal

Add a Microsoft SQL Server connector to SQL Preview as a pluggable `packages/sql-preview-mssql` package, covering the ~35% of enterprise environments that run MSSQL (SQL Server 2016–2022) and Azure SQL Database.

## Problem Statement

SQL Server is present across nearly every large enterprise, particularly in Microsoft-stack organisations running Azure, .NET, or Power BI ecosystems. These are precisely the environments where AI agents are being adopted earliest. Without MSSQL support, SQL Preview cannot serve this market.

SQL Server has meaningful dialect differences from ANSI SQL (T-SQL: `TOP`, `NOLOCK`, square-bracket identifiers, `GETDATE()`) but the query execution model is standard enough that the `IConnector` pattern applies cleanly.

## Scope

**In Scope:**

- `packages/sql-preview-mssql/` implementing `IConnector`
- `runQuery` via `mssql` npm package; buffered result with `QueryPage` yield
- `testConnection` via `sql.connect().then(() => sql.close())`
- `validateConfig`: host, port, user, database required; instance optional
- Schema metadata (RFC-016): `listSchemas`, `listTables`, `describeTable` via `INFORMATION_SCHEMA`
- Connection profile type: `mssql`
- Azure SQL Database compatibility (same wire protocol, standard auth)
- Windows Auth / Active Directory integration documented but not required for v1 (SQL auth is sufficient)
- CLI entrypoint, unit tests, README

**Out of Scope:**

- Active Directory Password / Integrated Security / Kerberos authentication (future RFC)
- Azure AD token-based auth (future RFC)
- Bulk load / BULK INSERT operations
- `EXECUTE` stored procedures (supported by `runQuery` transparently — no special handling needed)

## Proposal

### Driver

Use [`mssql`](https://www.npmjs.com/package/mssql) — the de facto standard Node.js SQL Server driver. It uses `tedious` as the underlying wire protocol implementation (pure JS, no native bindings).

### Connection Profile Shape

```typescript
interface MSSQLConnectionProfile extends BaseConnectionProfile {
  type: 'mssql';
  host: string;
  port: number; // default: 1433
  user: string;
  password?: string; // from ICredentialStore
  database: string;
  instance?: string; // named instance, e.g. SQLEXPRESS
  ssl?: boolean; // encrypt, default: true for Azure SQL
  trustServerCertificate?: boolean; // default: false; true for self-signed (dev/local)
  connectionTimeout?: number; // ms, default: 15000
  requestTimeout?: number; // ms, default: 30000
  domain?: string; // Windows domain for NTLM auth (optional)
}
```

> **Note:** `encrypt: true` is the Azure SQL default and required. For on-premises SQL Server with self-signed certificates, set `trustServerCertificate: true`. Document this clearly to avoid the #1 MSSQL connection error.

### `runQuery` Implementation

```typescript
async *runQuery(query: string, config: ConnectorConfig, _authHeader?: string, abortSignal?: AbortSignal): AsyncGenerator<QueryPage> {
  const cfg = config as MSSQLConnectionProfile;
  const mssql = await import('mssql');

  const pool = await mssql.connect({
    server: cfg.host,
    port: cfg.port ?? 1433,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    options: {
      encrypt: cfg.ssl ?? true,
      trustServerCertificate: cfg.trustServerCertificate ?? false,
      instanceName: cfg.instance,
      domain: cfg.domain,
    },
    connectionTimeout: cfg.connectionTimeout ?? 15000,
    requestTimeout: cfg.requestTimeout ?? 30000,
  });

  try {
    const result = await pool.request().query(query);
    const recordset = result.recordset ?? [];
    const columns: ColumnDef[] = result.recordset?.columns
      ? Object.entries(result.recordset.columns).map(([name, col]) => ({
          name,
          type: mapMssqlType((col as any).type?.declaration ?? ''),
        }))
      : Object.keys(recordset[0] ?? {}).map(name => ({ name, type: 'string' }));

    const data = recordset.map(row => columns.map(c => row[c.name]));

    yield {
      columns,
      data,
      stats: { state: 'FINISHED', rowCount: recordset.length },
    };
  } finally {
    await pool.close();
  }
}
```

### Type Mapping

| T-SQL type                                                                 | SQL Preview type            |
| -------------------------------------------------------------------------- | --------------------------- |
| `int`, `bigint`, `smallint`, `tinyint`                                     | `integer`                   |
| `float`, `real`, `decimal`, `numeric`, `money`, `smallmoney`               | `number`                    |
| `datetime`, `datetime2`, `smalldatetime`, `datetimeoffset`                 | `timestamp`                 |
| `date`                                                                     | `date`                      |
| `time`                                                                     | `string`                    |
| `bit`                                                                      | `boolean`                   |
| `uniqueidentifier`                                                         | `string`                    |
| All `varchar`, `nvarchar`, `text`, `ntext`, `char`, `nchar`, `xml`, `json` | `string`                    |
| `varbinary`, `binary`, `image`                                             | `string` (base64 in future) |

### Schema Metadata (RFC-016)

SQL Server's `INFORMATION_SCHEMA` is ANSI-compatible:

```sql
-- listSchemas
SELECT SCHEMA_NAME AS [schema]
FROM INFORMATION_SCHEMA.SCHEMATA
WHERE SCHEMA_NAME NOT IN ('db_accessadmin','db_backupoperator',
  'db_datareader','db_datawriter','db_ddladmin','db_denydatareader',
  'db_denydatawriter','db_owner','db_securityadmin','guest','INFORMATION_SCHEMA','sys')
ORDER BY SCHEMA_NAME;

-- listTables(schema)
SELECT TABLE_NAME AS name,
  CASE TABLE_TYPE WHEN 'BASE TABLE' THEN 'TABLE' ELSE TABLE_TYPE END AS type
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @schema
ORDER BY TABLE_NAME;

-- describeTable(table, schema)
SELECT COLUMN_NAME AS name,
  DATA_TYPE AS type,
  CASE IS_NULLABLE WHEN 'YES' THEN 1 ELSE 0 END AS nullable,
  ORDINAL_POSITION AS ordinalPosition,
  COLUMN_DEFAULT AS defaultValue
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
ORDER BY ORDINAL_POSITION;
```

Primary key detection via `INFORMATION_SCHEMA.KEY_COLUMN_USAGE` joined with `INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_TYPE = 'PRIMARY KEY'`.

### Error Classification

| mssql error                       | SQL Preview class     |
| --------------------------------- | --------------------- |
| `ETIMEOUT`, `ECONNREFUSED`        | `ConnectionError`     |
| Error number 18456 (login failed) | `AuthenticationError` |
| All other T-SQL errors            | `QueryError`          |

## Implementation Plan

1. Create `packages/sql-preview-mssql/` with `package.json`, `tsconfig.json`
2. Implement `MSSQLConnector` in `src/index.ts`
3. Implement `src/cli.ts`
4. Add `mssql` profile type to `src/common/types.ts`
5. Register in `DriverManager` / `ConnectorRegistry`
6. Implement RFC-016 metadata methods
7. Document `trustServerCertificate` requirement prominently
8. Write unit tests (mock `mssql` pool)
9. Integration test against SQL Server 2022 via Docker (`mcr.microsoft.com/mssql/server:2022-latest`)
10. Add to Connections form in RFC-018

## Acceptance Criteria

1. `runQuery('SELECT @@VERSION AS version', config)` returns one row with the SQL Server version string
2. `testConnection` throws `AuthenticationError` for wrong credentials, `ConnectionError` for unreachable host
3. `trustServerCertificate: true` in profile bypasses self-signed cert rejection (verified against Docker MSSQL)
4. Azure SQL Database: connecting to `*.database.windows.net` with SQL auth works (requires `encrypt: true`)
5. `listSchemas` excludes system schemas
6. `describeTable` returns `isPrimaryKey: true` for primary key columns
7. All unit tests pass

## Risks and Mitigations

| Risk                                                        | Likelihood | Mitigation                                                                                                                   |
| ----------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `tedious` (underlying driver) has large install size (~5MB) | Medium     | `--external:mssql` in esbuild; user installs via daemon's `DriverManager`                                                    |
| SSL/TLS errors are #1 user pain point                       | High       | Detect common errors and return friendly guidance in error message: "Set trustServerCertificate: true for local/dev servers" |
| Named instance connectivity requires UDP port 1434          | Low        | Document: provide explicit `port` in profile to skip instance enumeration                                                    |

## Rollout and Backout

**Rollout:** New package only. Additive — no existing code changes until a user creates an `mssql` profile.

**Backout:** Remove package, remove `mssql` from type union.

## Open Questions

1. Should we support Active Directory / Azure AD auth in v1? Decision: No. SQL auth covers 90% of cases. AD auth requires `msal-node` dependency and OAuth flow — a separate future RFC.
2. For Azure SQL, should `ssl` default to `true` when the host ends in `.database.windows.net`? Decision: Yes — auto-detect and set `encrypt: true` when hostname matches Azure SQL pattern.
