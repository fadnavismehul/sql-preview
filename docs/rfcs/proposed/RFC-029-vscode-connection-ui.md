# RFC-029: VS Code Dynamic Connection UI

**Status:** Proposed  
**Created:** 2026-03-04  
**Owner:** Core Team  
**Related RFCs:** RFC-028 (Dynamic Connection Setup UX), RFC-010 (Modular Connection Profiles), RFC-012 (Pluggable Connectors)

## Goal

Enhance the SQL Preview VS Code Extension's connection pane to utilize the dynamic, JSON Schema-driven connection profiles implemented in the Daemon via RFC-028. This will replace the hardcoded connector types with an extensible UI that seamlessly supports any registered connection plugin.

## Problem Statement

Currently, the VS Code Extension features a statically defined UI for creating connections. As seen in the existing UI, the "Connector Type" dropdown is hardcoded to specific options like "Trino / Presto", "SQLite", and "Custom (Plugin)".

With the successful implementation of [RFC-028](./RFC-028-connection-setup-ux.md), the backend Daemon now acts as the source of truth for available connectors and their required configuration fields (`configSchema`). However, the VS Code extension does not yet consume this intelligence. If a user installs a new connector plugin (e.g., DuckDB, Postgres), they cannot easily configure it natively through the VS Code UI because the extension's webview lacks the dynamic form generation capabilities that we recently built for the Claude Desktop MCP application.

## Scope

**In Scope:**

- Update the VS Code Extension's webview UI (`src/ui/webviews/`) to fetch available connectors via the backend API.
- Re-use or rebuild the `DynamicForm` concept within the VS Code UI infrastructure to render configuration inputs based on JSON Schemas.
- Modify the "Add Connection" and "Edit Connection" workflows in VS Code to be fully schema-driven.
- Ensure the UX aligns with VS Code's native component language (using VS Code WebView UI Toolkits if applicable).
- Connect the submittable actions to the existing `testConnection` and `saveProfile` backend handlers.

**Out of Scope:**

- Modifications to the Daemon or `@sql-preview/connector-api` (already handled in RFC-028).
- Adding new connector implementations.

## Proposal

### 1. Data Fetching

The VS Code extension's webview currently loads connection UI components explicitly. We will modify the initializer to query the backend (via `DaemonClient` or directly if running standalone) to request the list of available connectors and their `configSchema`s, similar to the `list_connectors` MCP tool.

### 2. Dynamic UI Component in Webview

The VS Code UI is built differently than the standalone React MCP App. We will implement a dynamic form generator within the VS Code webview context.

- **Type Selector**: The "Connector Type" dropdown will dynamically populate based on the returned list of registered connector IDs (`trino`, `postgres`, `duckdb`, `sqlite`, etc.).
- **Dynamic Fields**: Upon selecting a connector type, the UI will iterate over the JSON schema properties and render the appropriate input fields (e.g., text, number, password, checkbox).

### 3. State Binding and Submission

The values collected by the dynamic form will be aggregated into a standard connection profile configuration object and passed over the standard VS Code message passing interface to be tested and saved.

## Implementation Plan

1. **API Expansion (if needed)**: Expose the `getAvailableConnectors` logic from the Daemon to the VS Code Extension client in a format it can easily consume.
2. **Webview State Management**: Update the React-based Webview codebase (`src/ui/webviews/`) to manage the schema state.
3. **Build `DynamicForm` for VS Code**: Implement the schema-driven form logic specifically tailored for the VS Code theme and components.
4. **Integration**: Hook up form submission to validate inputs against required schema rules and trigger the underlying save/test mechanisms.

## Acceptance Criteria

1. Opening the VS Code Connection Pane shows a "Connector Type" dropdown containing all connectors registered in the Daemon.
2. Selecting a connector type instantly refreshes the form fields below to match its `configSchema` exactly.
3. Users can successfully configure, test, and save connections for Trino, SQLite, Postgres, DuckDB, etc., via the VS Code UI.
4. The hardcoded specific connection panes are removed from the VS Code UI codebase to reduce technical debt.
