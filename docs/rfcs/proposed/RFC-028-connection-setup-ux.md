# RFC-028: Dynamic Connection Setup UX for MCP UI

**Status:** Proposed  
**Created:** 2026-03-04  
**Owner:** Core Team  
**Related RFCs:** RFC-012 (Pluggable Connectors), RFC-018 (MCP UI Refinement)

## Goal

Provide a seamless, dynamic user experience (UX) for setting up and managing database connections directly from the MCP UI (e.g., inside Claude Desktop or a Browser). The UI must dynamically generate configuration forms based on the requirements of each specific connector (Postgres, Snowflake, BigQuery, etc.) without hardcoding form fields in the frontend component.

This is a dependency for the full rollout of **RFC-018**.

## Problem Statement

RFC-018 proposes bringing Connections CRUD to the MCP UI via `add_connection`, `update_connection`, and `remove_connection` MCP tools. However, different databases require radically different connection parameters:

- **Postgres:** `host`, `port`, `user`, `database`, `password`
- **Snowflake:** `account`, `warehouse`, `database`, `schema`, `user`, `password`
- **BigQuery:** `projectId`, `dataset`, `credentials` (JSON string) or `keyFilename`
- **DuckDB:** `path`

If we hardcode a switch statement containing all these form fields into the React MCP App, the frontend becomes tightly coupled to the backend connectors. Every time we add a new pluggable connector (RFC-012), we would have to deploy a new frontend build just to add its form fields.

## Proposal: Schema-Driven Dynamic Forms

The "right way" to implement this is to utilize **JSON Schema** to drive the frontend UI dynamically.

### 1. Connector Capabilities (Backend)

The `@sql-preview/connector-api` needs a reliable way for connectors to publish their required configuration structure.

- Each connector plugin should export a JSON Schema representing its configuration (`TrinoConfigSchema`, `PostgresConfigSchema`, etc.).
- A new MCP tool or an enhancement to an existing tool (e.g., `list_connectors` or `get_connector_schemas`) will return the registry of available connectors along with their JSON Schemas.

### 2. MCP App Connection Form (Frontend)

The MCP React UI will implement a Dynamic Form renderer.

1. The user clicks "Add Connection" and selects a database type (e.g., "Postgres").
2. The UI looks up the JSON Schema provided by the backend for "Postgres".
3. The UI automatically renders the appropriate text boxes, number inputs, password masks, and checkboxes (e.g., using `ajv` for validation and a generic component mapper, or a library like `@rjsf/core` if size permits).
4. Upon clicking "Save", the UI validates the form state against the JSON schema and passes the payload to the `add_connection` MCP tool.

### 3. Connection Setup Flow

1. **List Connectors:** UI queries Daemon for available drivers and schemas.
2. **Render Type Selector:** UI shows a grid of supported DB logos/names.
3. **Render Dynamic Form:** Upon selection, the JSON Schema is parsed into an HTML form. Required fields are marked; validation rules (like minimum length or enum values) are enforced client-side.
4. **Test Connection (Pre-Save):** The user clicks "Test". The UI calls the `test_connection` MCP tool with the unsaved payload.
5. **Save Connection:** The user clicks "Save". The UI calls `add_connection`. The Daemon encrypts passwords securely (via OS Keyring context if available) and saves to `~/.sql-preview/config.json`.

## Implementation Plan

1. **Update Connector API:** Define that `IConnector` or the registration mechanism must expose a generic JSON schema.
2. **Expose Schemas via Daemon:** Create or update the Daemon `list_connectors` MCP tool to return `{ id: "postgres", name: "PostgreSQL", schema: { ... } }`.
3. **Build Dynamic Form Component:** Implement a layout engine in `src/mcp-app` that iterates over a JSON Schema `properties` object to render `<input type="text">`, `<input type="password">`, `<input type="number">`, and `<input type="checkbox">`.
4. **Complete RFC-018:** Wire the resulting JSON payload into the `add_connection` and `update_connection` tools proposed in RFC-018.

## Acceptance Criteria

- Adding a new connector to the backend automatically provides the frontend with the correct form fields without touching React code.
- Users can create, update, delete, and test connections strictly through the MCP App UI in Claude Desktop.
- Passwords are obfuscated in the UI and securely handled by the Daemon.
