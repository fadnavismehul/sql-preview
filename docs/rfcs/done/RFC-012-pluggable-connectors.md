# RFC-012: Pluggable Connector Architecture

**Feature Name:** Pluggable Connectors (Starting with PostgreSQL)
**Status:** Implemented
**Created:** 2026-02-25
**Owner:** Core Team

## Summary

This RFC proposes an architecture to allow third-party developers and users to add new database connectors (like PostgreSQL, MySQL, SQL Server, etc.) to the SQL Preview extension without bloating the core extension's dependencies or requiring pull requests to the main repository. As part of this implementation, existing built-in connectors (PostgreSQL, SQLite, DuckDB) have been extracted into their own standalone pluggable packages.

## Motivation

Our users want to connect to a wider variety of databases. Currently, every new database requires modifying the core extension, creating a new implementation in `src/connectors/`, and managing its dependencies. Some drivers (like `pg` for Postgres, SQLite WASM binaries, or DuckDB native modules) are quite large and sometimes require native bindings.
To avoid bloating the VSIX package and to empower the community, we need a pluggable architecture where connectors are separate, opt-in entities.

## Proposed Options

### Option 1: VS Code Extension API (Recommended for deep integration)

SQL Preview exposes an extension API in `activate()`:

```typescript
export interface SQLPreviewAPI {
  registerConnector(id: string, modulePath: string): void;
}
```

Other extensions declare an extension dependency on `sql-preview` and call this API, providing an absolute path to their connector implementation `.js` file. The Daemon dynamically `import()`s this script.

- **Pros:** Native VSCode ecosystem experience. Extensions can provide dedicated UI/commands.
- **Cons:** High barrier to entry (requires building a full VS Code extension).

### Option 2: Connection Profiles UI Integration (Recommended)

Leverage the existing Connection Profiles architecture (RFC-010). We introduce a `custom` connection type.
Users create a new connection profile via the extension's UI, select "Custom" as the type, and provide the NPM package name (e.g., `sql-preview-mysql`) alongside a generic JSON block for connection properties.
When this profile is invoked, the Daemon's `DriverManager` (which already knows how to `npm install` missing packages) installs the NPM package and dynamically loads the connector.

- **Pros:** Excellent UX. Integrated directly into the existing Connections UI. Zero friction for authors (publish an NPM package with one class).
- **Cons:** Relies on NPM registry. Unvetted packages could pose a security risk (though they only run locally).

### Option 3: Local File Path

Users configure `sqlPreview.localConnectors: ["/path/to/my-connector.js"]`.
The Daemon dynamically `require()`s the file.

- **Pros:** Great for internal company databases or local hacks.
- **Cons:** Not easily distributable.

## Proposed Architecture (Hybrid approach)

We will proceed with a combination of **Option 2** and **Option 1**.

1. We will formalize `IConnector` as an external `@sql-preview/connector-api` NPM package so authors can type-check against it.
2. We will expand `ConnectionProfile` to support a `custom` type that includes a `connectorPackage` field and a generic `config` JSON object.
3. The UI will be updated to allow creating these custom profiles. The UI will rely on a generic key-value block for configuration properties, keeping the implementation simple.
4. The `DaemonQueryExecutor` and `ConnectionManager` will dynamically install and instantiate the custom package using `DriverManager` when a query is executed against a custom profile.
5. **Initial Implementation:** We will refactor the existing `PostgreSQLConnector`, `SQLiteConnector`, and `DuckDbConnector` out of the main repository into their own standalone packages (`packages/sql-preview-*`) to prove the architecture works and decouple the monolith.

## Implementation Steps

1. Extract `IConnector` and necessary types (`QueryPage`, `ColumnDef`) into a shared interface file or separate lightweight npm package (`@sql-preview/connector-api`).
2. Update `BaseConnectionProfile` and related UI components in `src/ui/` to support the `custom` type and generic config properties.
3. Modify `DriverManager` to install full connector packages (if provided via `connectorPackage`).
4. Update `DaemonQueryExecutor` or `ConnectorFactory` to dynamically `import()` the resolved path for the custom connector based on the invoked profile.
5. Remove `PostgreSQLConnector.ts`, `SQLiteConnector.ts`, and `DuckDbConnector.ts` from the core project, create standalone plugin packages for them under `packages/`, and test the pluggable architecture using them.
