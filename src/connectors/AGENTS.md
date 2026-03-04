# Database Connectors

> **Context**: This layer abstracts the differences between various database SQL dialects and drivers. It provides a unified interface for the rest of the application to execute queries and fetch metadata.

## 🗺️ Map

- **[base/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/connectors/base/)**:
  - `BaseConnector.ts`: Abstract base class defining the contract (connect, execute, test).
  - `ConnectorRegistry.ts`: Registry to keep track of natively supported connectors.
- **[postgres/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/connectors/postgres/)**: PostgreSQL implementation using `pg`. Note: Trino, BigQuery and others have been migrated out of this directory and exist as pluggable `@sql-preview` packages.
- **[sqlite/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/connectors/sqlite/)**: SQLite implementation.
- **[duckdb/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/connectors/duckdb/)**: DuckDB implementation using `@duckdb/node-api`.
  - **Note**: This connector is feature-flagged and disabled by default due to native module constraints.

## 🔌 Interface Contract

All connectors must implement `IConnector`:

```typescript
interface IConnector {
  connect(config: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  execute(query: string): Promise<QueryResult>;
  testConnection(): Promise<boolean>;
  getMetadata(type: 'tables' | 'columns', ...args): Promise<MetadataResult>;
}
```

## ⚠️ Implementation Guidelines

1.  **Connection Pooling**: manage pools efficiently. Don't open a new connection for every query if the driver supports pooling.
2.  **Error Handling**: Wrap driver-specific errors in standard application error types.
3.  **Sanitization**: Even though we expect valid SQL, ensure basic parameter sanitization where applicable to prevent injection in metadata queries.
