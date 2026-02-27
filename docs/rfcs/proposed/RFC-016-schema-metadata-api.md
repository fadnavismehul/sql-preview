# RFC-016: Schema Metadata API

**Status:** Proposed  
**Created:** 2026-02-27  
**Owner:** Core Team  
**Related RFCs:** RFC-012 (Pluggable Connectors), RFC-013 (Agentic MCP Connectors), RFC-015 (Long-Lived Subprocesses)

## Goal

Provide a standardized metadata API across all connectors so that agents, editors, and UI components can browse database schemas, tables, columns, and types without resorting to raw SQL queries.

## Problem Statement

The `IConnector` interface currently has two methods: `runQuery()` and `testConnection()`. There is no way to programmatically discover what schemas, tables, or columns exist in a connected database. This creates several problems:

### 1. Agent Intelligence is Blind

MCP clients (Claude, Cursor, etc.) must guess table and column names when constructing SQL queries. The only workaround is running raw metadata queries (`SHOW TABLES`, `\dt`, `.tables`), which:

- Vary by database dialect (Trino uses `SHOW SCHEMAS FROM catalog`, Postgres uses `\dt` or `information_schema`, SQLite uses `sqlite_master`)
- Return unstructured text that agents must parse
- Require the agent to know which dialect it's talking to

### 2. No Autocomplete Foundation

SQL editors universally provide schema-aware autocomplete. Without a metadata API, the VS Code extension cannot offer completions for table names, column names, or function names — a basic feature users expect.

### 3. AGENTS.md Promises Unfulfilled

The `src/connectors/AGENTS.md` documents a `getMetadata(type: 'tables' | 'columns', ...args)` method on `IConnector`, but this method does not exist in the actual interface. The architectural intent is clear but unimplemented.

### 4. MCP Tool Gap

The `DaemonMcpToolManager` exposes `list_connections` and `list_sessions`, but no `inspect_schema`, `list_tables`, or `describe_table` tools. Agents operating against the MCP server have no metadata discovery capability.

### Current State of Metadata Queries

| Connector | How metadata is accessed today                                 | Limitation                                 |
| --------- | -------------------------------------------------------------- | ------------------------------------------ |
| Trino     | `SHOW CATALOGS`, `SHOW SCHEMAS FROM x`, `SHOW TABLES FROM x.y` | Returns text, requires multi-step queries  |
| Postgres  | `SELECT * FROM information_schema.tables`                      | Requires knowledge of `information_schema` |
| SQLite    | `SELECT name FROM sqlite_master WHERE type='table'`            | No column type info (all `unknown`)        |
| DuckDB    | `SHOW TABLES`, `DESCRIBE table`                                | Returns text, no structured API            |

## Scope

### In Scope

- `IConnector` interface extension with metadata methods
- Metadata implementations for all four connectors (Trino, Postgres, SQLite, DuckDB)
- New MCP tools for schema discovery (`list_schemas`, `list_tables`, `describe_table`)
- Metadata caching strategy in the daemon
- Subprocess protocol extension for metadata (compatible with RFC-015)

### Out of Scope

- SQL autocomplete in the VS Code editor (future work that builds on this API)
- Schema tree view sidebar in VS Code (future work)
- Schema diffing or migration tools
- Write operations (CREATE TABLE, ALTER, etc.)

## Proposal

### 1. Extended IConnector Interface

Add optional metadata methods to `IConnector` in `packages/sql-preview-connector-api/`:

```typescript
// New types
interface SchemaInfo {
  catalog?: string;
  schema: string;
}

interface TableInfo {
  catalog?: string;
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW' | 'MATERIALIZED_VIEW' | 'SYSTEM_TABLE' | 'UNKNOWN';
  comment?: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  ordinalPosition: number;
  defaultValue?: string;
  comment?: string;
  isPrimaryKey?: boolean;
}

interface TableDetail {
  table: TableInfo;
  columns: ColumnInfo[];
  rowCount?: number; // approximate, if available cheaply
}

// Extended connector interface
interface IConnector<TConfig extends ConnectorConfig = ConnectorConfig> {
  // ... existing methods unchanged ...

  readonly supportsMetadata: boolean;

  listSchemas?(config: TConfig, catalog?: string, authHeader?: string): Promise<SchemaInfo[]>;

  listTables?(
    config: TConfig,
    schema: string,
    catalog?: string,
    authHeader?: string
  ): Promise<TableInfo[]>;

  describeTable?(
    config: TConfig,
    table: string,
    schema: string,
    catalog?: string,
    authHeader?: string
  ): Promise<TableDetail>;
}
```

**Design decisions:**

- Methods are optional (`?`) for backward compatibility with existing connectors
- `supportsMetadata` boolean allows runtime capability detection
- `catalog` is optional since not all databases have the catalog concept (SQLite, DuckDB don't)
- Return types are rich enough for UI rendering but simple enough for agent consumption

### 2. Connector Implementations

#### Trino

```typescript
class TrinoConnector implements IConnector<TrinoConfig> {
  readonly supportsMetadata = true;

  async listSchemas(config: TrinoConfig, catalog?: string): Promise<SchemaInfo[]> {
    const cat = catalog || config.catalog || 'system';
    // Uses: SHOW SCHEMAS FROM <catalog>
    // Parses tabular response into SchemaInfo[]
  }

  async listTables(config: TrinoConfig, schema: string, catalog?: string): Promise<TableInfo[]> {
    const cat = catalog || config.catalog;
    // Uses: SELECT table_name, table_type FROM <catalog>.information_schema.tables
    //       WHERE table_schema = '<schema>'
    // Provides rich type info (TABLE, VIEW, etc.)
  }

  async describeTable(
    config: TrinoConfig,
    table: string,
    schema: string,
    catalog?: string
  ): Promise<TableDetail> {
    // Uses: SELECT column_name, data_type, is_nullable, ordinal_position, column_default, comment
    //       FROM <catalog>.information_schema.columns
    //       WHERE table_schema = '<schema>' AND table_name = '<table>'
  }
}
```

#### Postgres

```typescript
class PostgresConnector implements IConnector {
  readonly supportsMetadata = true;

  async listSchemas(config: ConnectorConfig): Promise<SchemaInfo[]> {
    // Uses: SELECT schema_name FROM information_schema.schemata
    //       WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  }

  async listTables(config: ConnectorConfig, schema: string): Promise<TableInfo[]> {
    // Uses: SELECT table_name, table_type FROM information_schema.tables
    //       WHERE table_schema = $1
    // Maps: 'BASE TABLE' → 'TABLE', 'VIEW' → 'VIEW'
  }

  async describeTable(
    config: ConnectorConfig,
    table: string,
    schema: string
  ): Promise<TableDetail> {
    // Uses: information_schema.columns JOIN pg_indexes for primary key detection
    // Also: pg_class.reltuples for approximate row count
  }
}
```

#### SQLite

```typescript
class SQLiteConnector implements IConnector {
  readonly supportsMetadata = true;

  async listSchemas(): Promise<SchemaInfo[]> {
    // SQLite has a single implicit schema
    return [{ schema: 'main' }];
  }

  async listTables(config: ConnectorConfig, schema: string): Promise<TableInfo[]> {
    // Uses: SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view')
    // Maps: 'table' → 'TABLE', 'view' → 'VIEW'
  }

  async describeTable(config: ConnectorConfig, table: string): Promise<TableDetail> {
    // Uses: PRAGMA table_info(<table>) — returns cid, name, type, notnull, dflt_value, pk
    // Also: SELECT COUNT(*) FROM <table> for row count (only for small tables)
  }
}
```

#### DuckDB

```typescript
class DuckDBConnector implements IConnector {
  readonly supportsMetadata = true;

  async listSchemas(): Promise<SchemaInfo[]> {
    // Uses: SELECT schema_name FROM information_schema.schemata
  }

  async listTables(config: ConnectorConfig, schema: string): Promise<TableInfo[]> {
    // Uses: SELECT table_name, table_type FROM information_schema.tables
    //       WHERE table_schema = $1
  }

  async describeTable(
    config: ConnectorConfig,
    table: string,
    schema: string
  ): Promise<TableDetail> {
    // Uses: SELECT column_name, data_type, is_nullable, ordinal_position, column_default
    //       FROM information_schema.columns
    // DuckDB supports standard information_schema
  }
}
```

### 3. Subprocess Protocol Extension

For out-of-process connectors, extend the JSON-RPC protocol (as defined in RFC-015):

```jsonc
// Daemon → Connector
{"jsonrpc": "2.0", "id": 10, "method": "listSchemas", "params": {"catalog": "hive"}}
{"jsonrpc": "2.0", "id": 11, "method": "listTables", "params": {"schema": "default", "catalog": "hive"}}
{"jsonrpc": "2.0", "id": 12, "method": "describeTable", "params": {"table": "users", "schema": "public"}}

// Connector → Daemon
{"jsonrpc": "2.0", "id": 10, "result": [{"schema": "default"}, {"schema": "information_schema"}]}
{"jsonrpc": "2.0", "id": 11, "result": [{"schema": "default", "name": "users", "type": "TABLE"}]}
{"jsonrpc": "2.0", "id": 12, "result": {"table": {...}, "columns": [...]}}
```

For one-shot mode (backward compat with `SubProcessConnectorClient`), the CLI accepts `--metadata <method> --params <base64json>` flags alongside `--query`.

### 4. New MCP Tools

Add three new tools to `DaemonMcpToolManager`:

```typescript
{
  name: 'list_schemas',
  description: 'List all schemas (databases) available in a connection. Returns schema names and optional catalog grouping.',
  inputSchema: {
    type: 'object',
    properties: {
      connectionId: { type: 'string', description: 'Connection ID from list_connections' },
      catalog: { type: 'string', description: 'Optional catalog name (for multi-catalog databases like Trino)' },
    },
    required: ['connectionId'],
  },
}

{
  name: 'list_tables',
  description: 'List all tables and views in a schema. Returns table names, types (TABLE/VIEW), and optional comments.',
  inputSchema: {
    type: 'object',
    properties: {
      connectionId: { type: 'string', description: 'Connection ID from list_connections' },
      schema: { type: 'string', description: 'Schema name from list_schemas' },
      catalog: { type: 'string', description: 'Optional catalog name' },
    },
    required: ['connectionId', 'schema'],
  },
}

{
  name: 'describe_table',
  description: 'Get detailed information about a table including all columns, their types, nullability, and constraints. Useful for understanding table structure before writing queries.',
  inputSchema: {
    type: 'object',
    properties: {
      connectionId: { type: 'string', description: 'Connection ID from list_connections' },
      table: { type: 'string', description: 'Table name from list_tables' },
      schema: { type: 'string', description: 'Schema name' },
      catalog: { type: 'string', description: 'Optional catalog name' },
    },
    required: ['connectionId', 'table', 'schema'],
  },
}
```

### 5. Metadata Caching

Schema metadata is relatively stable and expensive to fetch (especially over network). Implement a simple TTL cache in the daemon:

```typescript
class MetadataCache {
  private cache = new Map<string, { data: unknown; fetchedAt: number }>();
  private readonly ttlMs: number; // default: 60 seconds

  get<T>(key: string): T | undefined;
  set<T>(key: string, data: T): void;
  invalidate(pattern: string): void; // regex match on keys
  clear(): void;
}
```

**Cache key format**: `metadata:${connectionId}:${method}:${catalog}:${schema}:${table}`

**Invalidation**: Cache is cleared when:

- Connection profile is updated
- User explicitly requests refresh (new `refresh` param on MCP tools)
- TTL expires (configurable, default 60s)

DDL queries (`CREATE`, `ALTER`, `DROP`) detected by the query executor automatically invalidate the cache for the affected connection.

## Alternatives Considered

| Alternative                                                   | Rejection Reason                                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Teach agents to run raw SQL**                               | Fragile — dialect differences, parsing unstructured output, no caching. Defeats the purpose of an abstraction layer.                     |
| **Static schema file (`.sql-preview-schema.json`)**           | Stale immediately. Doesn't work for remote databases. Requires manual maintenance.                                                       |
| **Full ORM-style metadata (relations, indexes, constraints)** | Too complex for v1. Start with tables/columns, extend later. The interface is designed to allow adding methods without breaking changes. |
| **GraphQL-style introspection**                               | Over-engineered for this use case. JSON-RPC methods are simpler and align with MCP tool model.                                           |

## Implementation Plan

### Phase 1: Types & Interface (connector-api package)

1. Add `SchemaInfo`, `TableInfo`, `ColumnInfo`, `TableDetail` types to `@sql-preview/connector-api`
2. Add optional `supportsMetadata`, `listSchemas`, `listTables`, `describeTable` to `IConnector`
3. Export new types from package

### Phase 2: In-Process Implementation (Trino)

4. Implement metadata methods in `TrinoConnector`
5. Add unit tests with mocked HTTP responses
6. Wire into `DaemonQueryExecutor` as a metadata passthrough

### Phase 3: Subprocess Implementations

7. Implement metadata methods in `sql-preview-postgres`
8. Implement metadata methods in `sql-preview-sqlite`
9. Implement metadata methods in `sql-preview-duckdb`
10. Extend `SubProcessConnectorClient` to support `--metadata` flag
11. (If RFC-015 is implemented) Extend `LongLivedConnectorClient` with metadata JSON-RPC methods

### Phase 4: MCP Tools & Caching

12. Add `MetadataCache` to daemon
13. Add `list_schemas`, `list_tables`, `describe_table` MCP tools
14. Wire metadata tools through cache → connector pipeline
15. Add DDL detection for cache invalidation in `DaemonQueryExecutor`

### Phase 5: Testing

16. Integration tests: metadata tools via MCP client against each connector
17. Unit tests: cache TTL, invalidation, DDL detection
18. Verify agent workflow: `list_connections` → `list_schemas` → `list_tables` → `describe_table` → `run_query`

## Acceptance Criteria

1. **Agent workflow**: An MCP client can discover schemas, tables, and columns using structured tool calls without knowing the SQL dialect
2. **All connectors**: `list_schemas`, `list_tables`, `describe_table` work for Trino, Postgres, SQLite, and DuckDB
3. **Capability detection**: Connectors that don't implement metadata methods gracefully return `"Metadata not supported for this connector"` instead of crashing
4. **Caching**: Repeated `list_tables` calls within 60s return cached results (verifiable via response timing)
5. **Cache invalidation**: Running `CREATE TABLE foo (...)` followed by `list_tables` shows the new table
6. **Backward compat**: Existing `runQuery` and `testConnection` flows are completely unaffected

## Risks and Mitigations

| Risk                                                        | Likelihood | Mitigation                                                                                      |
| ----------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| Large schemas (thousands of tables) slow down `list_tables` | Medium     | Add `limit` and `filter` parameters to MCP tools. Paginate results.                             |
| Metadata queries require elevated permissions               | Low        | Graceful error: "Insufficient permissions to list schemas. Grant SELECT on information_schema." |
| Cache serves stale data after external DDL                  | Medium     | Short default TTL (60s). `refresh: true` parameter on tools for explicit bypass.                |
| `information_schema` not available in all Postgres configs  | Very Low   | Fall back to `pg_catalog` queries as secondary strategy                                         |

## Rollout and Backout

**Rollout**: Metadata methods are optional on `IConnector`. New MCP tools are additive. No existing behavior changes. Fully backward compatible.

**Backout**: Remove the three new MCP tool registrations from `DaemonMcpToolManager`. The interface additions are harmless if unimplemented.

## Open Questions

1. **Should `list_tables` support cross-schema search?** E.g., `list_tables(connectionId, schema: "*")` to search all schemas. Useful for agents, but potentially expensive.
2. **Include table/column comments in default response?** Comments are valuable for agents to understand semantics, but some databases don't support them natively.
3. **Row count estimation**: Should `describeTable` include approximate row counts? Cheap for Postgres (`pg_class.reltuples`), expensive for SQLite (`COUNT(*)`). Make it opt-in?
