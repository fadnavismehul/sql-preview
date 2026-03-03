# RFC-019: MySQL / MariaDB Connector

**Status:** Implemented  
**Created:** 2026-03-02  
**Owner:** Core Team  
**Related RFCs:** RFC-012 (Pluggable Connectors), RFC-013 (Agentic MCP Connectors), RFC-016 (Schema Metadata API)

## Goal

Add a MySQL / MariaDB connector to SQL Preview as a pluggable `packages/sql-preview-mysql` package, enabling MCP agents to query the most widely deployed open-source relational database (~40% enterprise share) using the same `IConnector` interface as PostgreSQL.

## Problem Statement

MySQL and MariaDB collectively represent the largest addressable connector gap. They are present in the majority of web applications, SaaS backends, and legacy enterprise systems. Without MySQL support, SQL Preview's MCP tools are unavailable to a plurality of potential users.

The pluggable connector architecture (RFC-012 / RFC-013) is fully in place; adding MySQL requires only implementing the `IConnector` interface and publishing a new package.

## Scope

**In Scope:**

- `packages/sql-preview-mysql/` package implementing `IConnector`
- `runQuery`: full result buffering via `mysql2/promise`; async generator yield of `QueryPage`
- `testConnection`: ping via `connection.ping()`
- `validateConfig`: host, port, user, database required
- Schema metadata methods (per RFC-016): `listSchemas`, `listTables`, `describeTable` using `information_schema`
- Connection profile type: `mysql` added to the discriminated union in `src/common/types.ts`
- CLI entrypoint (`src/cli.ts`) matching the pattern in `sql-preview-postgres`
- Unit tests with mocked `mysql2` client
- Documentation: `packages/sql-preview-mysql/README.md`

**Out of Scope:**

- MariaDB-specific SQL dialect extensions
- Prepared statement support beyond what `mysql2` transparently provides
- SSL certificate pinning (supported via standard `ssl` config flag, not custom trust store)
- Connection pooling (driver-level; single connection per query for now, matching Postgres behaviour)

## Proposal

### Driver

Use [`mysql2`](https://www.npmjs.com/package/mysql2) — the community standard, maintained, Promise-native, and TypeScript-typed. It supports both MySQL ≥ 5.7 and MariaDB ≥ 10.2.

`mysql2` is a pure-JS driver; **no native bindings** are required. The `esbuild` bundle is self-contained.

### Connection Profile Shape

```typescript
interface MySQLConnectionProfile extends BaseConnectionProfile {
  type: 'mysql';
  host: string;
  port: number; // default: 3306
  user: string;
  password?: string; // resolved at runtime from ICredentialStore
  database: string;
  ssl?: boolean;
  sslVerify?: boolean; // default: true
  timezone?: string; // default: 'local', e.g. 'UTC'
  connectTimeout?: number; // ms, default: 10000
}
```

### `runQuery` Implementation

```typescript
async *runQuery(query: string, config: ConnectorConfig, _authHeader?: string, abortSignal?: AbortSignal): AsyncGenerator<QueryPage> {
  const cfg = config as MySQLConnectionProfile;
  const mysql2 = await import('mysql2/promise');

  const connection = await mysql2.createConnection({
    host: cfg.host,
    port: cfg.port ?? 3306,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: cfg.sslVerify ?? true } : undefined,
    timezone: cfg.timezone ?? 'local',
    connectTimeout: cfg.connectTimeout ?? 10000,
  });

  try {
    const [rows, fields] = await connection.query({ sql: query, rowsAsArray: true });
    const columns: ColumnDef[] = (fields ?? []).map(f => ({
      name: f.name,
      type: mapMysqlType(f.type),
    }));

    yield {
      columns,
      data: rows as unknown[][],
      stats: { state: 'FINISHED', rowCount: Array.isArray(rows) ? rows.length : 0 },
    };
  } finally {
    await connection.end();
  }
}
```

### Type Mapping

| mysql2 type constant                         | SQL Preview type |
| -------------------------------------------- | ---------------- |
| `TINY`, `SHORT`, `LONG`, `LONGLONG`, `INT24` | `integer`        |
| `FLOAT`, `DOUBLE`, `DECIMAL`, `NEWDECIMAL`   | `number`         |
| `TIMESTAMP`, `DATETIME`, `DATETIME2`         | `timestamp`      |
| `DATE`                                       | `date`           |
| `BIT`                                        | `boolean`        |
| Everything else                              | `string`         |

### Schema Metadata (RFC-016)

MySQL's `information_schema` is standard SQL-92, making this implementation straightforward:

```sql
-- listSchemas
SELECT schema_name AS `schema`
FROM information_schema.schemata
WHERE schema_name NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
ORDER BY schema_name;

-- listTables(schema)
SELECT table_name AS name, table_type AS type,
       table_comment AS comment
FROM information_schema.tables
WHERE table_schema = ?
ORDER BY table_name;

-- describeTable(table, schema)
SELECT column_name AS name, data_type AS type,
       is_nullable = 'YES' AS nullable,
       ordinal_position,
       column_default AS defaultValue,
       column_comment AS comment,
       column_key = 'PRI' AS isPrimaryKey
FROM information_schema.columns
WHERE table_schema = ? AND table_name = ?
ORDER BY ordinal_position;
```

### Error Classification

| mysql2 error code                        | SQL Preview error class |
| ---------------------------------------- | ----------------------- |
| `ECONNREFUSED`, `ER_ACCESS_DENIED_ERROR` | `ConnectionError`       |
| `ER_ACCESS_DENIED_ERROR` (user/password) | `AuthenticationError`   |
| `ER_NO_SUCH_TABLE`, query-level errors   | `QueryError`            |

### Package Structure

```
packages/sql-preview-mysql/
├── src/
│   ├── index.ts          # MySQLConnector class (default export)
│   └── cli.ts            # CLI entrypoint (--query, --config flags)
├── package.json
└── tsconfig.json
```

`package.json` mirrors `sql-preview-postgres`:

```json
{
  "name": "sql-preview-mysql",
  "version": "1.0.0",
  "description": "MySQL / MariaDB connector for SQL Preview",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": { "sql-preview-mysql": "./dist/cli.js" },
  "scripts": {
    "build": "esbuild src/index.ts --bundle --outfile=dist/index.js --platform=node --format=cjs --external:mysql2 && esbuild src/cli.ts --bundle --outfile=dist/cli.js --platform=node --format=cjs --external:mysql2 --banner:js=\"#!/usr/bin/env node\""
  },
  "dependencies": { "mysql2": "^3.9.0" },
  "devDependencies": { "esbuild": "^0.19.0", "typescript": "^5.0.0" }
}
```

## Alternatives Considered

| Alternative                 | Rejection Reason                             |
| --------------------------- | -------------------------------------------- |
| **`mysql` (v2)**            | Unmaintained, no Promise support, deprecated |
| **`@planetscale/database`** | PlanetScale-only, not general MySQL          |
| **JDBC bridge**             | Requires Java runtime, huge dependency       |

## Implementation Plan

1. Create `packages/sql-preview-mysql/` directory with `package.json`, `tsconfig.json`
2. Implement `MySQLConnector` in `src/index.ts`:
   - `validateConfig`, `testConnection`, `runQuery`
   - Full type mapping table
3. Implement `src/cli.ts` (identical pattern to `sql-preview-postgres/src/cli.ts`)
4. Add `mysql` profile type to `src/common/types.ts` discriminated union
5. Register `MySQLConnector` in `src/connectors/ConnectorRegistry` or `DriverManager`
6. Implement RFC-016 metadata methods (`listSchemas`, `listTables`, `describeTable`)
7. Write unit tests (mock `mysql2` using `jest.mock`)
8. Write `packages/sql-preview-mysql/README.md`
9. `npm run build` — verify `dist/` output
10. Add to the Connections form in RFC-018 (MCP UI Refinement)

## Acceptance Criteria

1. `packages/sql-preview-mysql/dist/index.js` exists and exports `MySQLConnector` as default
2. `validateConfig` returns an error if `host`, `port`, `user`, or `database` is missing
3. `runQuery('SELECT 1 + 1 AS result', config)` yields one `QueryPage` with columns `[{name:'result',type:'integer'}]` and data `[[2]]`
4. `testConnection` resolves `true` for a valid config and throws `ConnectionError` for an unreachable host
5. `listSchemas` returns schemas excluding system schemas (`information_schema`, `performance_schema`, `mysql`, `sys`)
6. `listTables('mydb')` returns tables and views in that schema
7. `describeTable('users', 'mydb')` returns column info including `isPrimaryKey: true` for the primary key column
8. All unit tests pass: `npm test -- --testPathPattern=mysql`
9. Integration test: connect to a local MySQL 8.0 Docker container, run `SELECT VERSION()`, receive a result

## Risks and Mitigations

| Risk                                                 | Likelihood | Mitigation                                                                             |
| ---------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `mysql2` BigInt serialization differs from engine    | Low        | Use `supportBigNumbers: true, bigNumberStrings: false` to preserve JS number semantics |
| MariaDB `information_schema` columns differ slightly | Medium     | Test against MariaDB 10.6 LTS in CI                                                    |
| MySQL 5.7 EOL but still widely deployed              | Low        | Ensure `mysql2` v3 still supports 5.7 protocol; it does                                |

## Rollout and Backout

**Rollout:** New package only. The core extension and Daemon have zero dependency on this package until a user creates a `mysql` connection profile. Fully additive.

**Backout:** Remove the package directory. Remove `mysql` from the type union. No existing functionality affected.

## Open Questions

1. Should we support `socketPath` for MySQL socket connections (common in shared-hosting environments)? Low priority; add as optional field in follow-up.
2. Should `connectTimeout` be a profile-level setting or daemon-level config (RFC-017)? Decision: profile-level for now, with the daemon config as a global override later.
