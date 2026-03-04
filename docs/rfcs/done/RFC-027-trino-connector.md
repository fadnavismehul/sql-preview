# RFC-027: Trino Connector Migration to Pluggable Architecture

**Status:** Done  
**Created:** 2026-03-04  
**Owner:** Core Team  
**Related ADRs:** RFC-012

## Goal

To migrate the built-in Trino connector to a standalone pluggable package (`packages/sql-preview-trino`), aligning it with the architecture defined in RFC-012 (Pluggable Connectors).

## Problem Statement

Currently, the Trino connector is tightly coupled with the core extension's codebase (`src/connectors/trino`). This violates the pluggable connector pattern established for other databases (PostgreSQL, SQLite, DuckDB, etc.), increasing the core plugin's maintenance burden, risking dependency bloat, and treating Trino uniquely among all supported databases.

## Scope

- **In Scope:** Moving the `TrinoConnector` class, related utilities, and unit/integration tests to `packages/sql-preview-trino`. Implementing the `@sql-preview/connector-api` for the new package. Updating the VS Code extension to dynamically load the Trino package replacing the current static instantiation.
- **Out of Scope:** Changing the functional capabilities of the Trino connector itself. Adding new features to Trino.

## Proposal

We propose extracting the `src/connectors/trino` directory into a new NPM package located at `packages/sql-preview-trino`.

1. The new package will implement the standard `IConnector` interface from `@sql-preview/connector-api`.
2. The `ServiceContainer.ts` static registration of `TrinoConnector` will be removed.
3. `ConnectionManager.ts` will continue to provide a workspace fallback profile for Trino, but the `type` 'trino' will be handled by the Daemon's dynamic package resolution mechanism and `DriverManager`.
4. `QueryExecutor.ts` will rely on the Daemon to execute `testConnection` for Trino, as it does for other custom pluggable connectors, eliminating the need to instantiate `TrinoConnector` in the extension's local process for connectivity checks.

## Alternatives Considered

- **Do Nothing:** Keep Trino built-in. This preserves the status quo but fractures the architecture into "built-in" and "pluggable" classes of connectors, which complicates future development and testing patterns.

## Implementation Plan

1. Create `packages/sql-preview-trino` with a `package.json` indicating dependencies on `@sql-preview/connector-api` and `trino-client`.
2. Move `src/connectors/trino/` into `packages/sql-preview-trino/src/`.
3. Move associated tests from `src/test/connectors/` to `packages/sql-preview-trino/test/`.
4. Update `src/services/ServiceContainer.ts`, `src/services/ConnectionManager.ts`, and `src/core/execution/QueryExecutor.ts` to remove direct imports of `TrinoConnector`.
5. Update `DriverManager` and connection resolution to resolve `trino` type to the new package dynamically.

## Acceptance Criteria

- `TrinoConnector` is fully removed from `src/connectors/`.
- All `TrinoConnector` unit tests pass within `packages/sql-preview-trino`.
- The VS Code extension successfully executes predefined Trino queries and schema browsing features against a local Trino instance without breaking backward compatibility for users' `workspace-fallback-trino` profiles.
- Testing a Trino connection evaluates correctly over the Daemon.

## Risks and Mitigations

- **Risk:** Existing VS Code extension users might lose their Trino fallback connection if dynamic loading fails or the NPM package requires external network access to install.
  - **Mitigation:** Ship `sql-preview-trino` alongside the VSIX or ensure `DriverManager` is able to locate the local pre-built module gracefully without an outbound NPM fetch if possible, or treat Trino as a bundled pluggable dependency.
- **Risk:** VS Code extension `testConnection` logic breaks.
  - **Mitigation:** Ensure the Daemon supports testing connections and `QueryExecutor.ts` delegates this action to the Daemon instead of performing a local `valError` check.

## Rollout and Backout

- **Rollout:** Shipped in a standard minor version extension update. Ensure all automated tests cover the transition.
- **Backout:** Revert the commits moving the directory and restoring static loading in `ServiceContainer.ts`.
