# RFC Index and Process

**Status:** Implemented  
**Created:** 2026-02-16  
**Owner:** Core Team

## Purpose

This folder stores Request for Comments (RFCs) for non-trivial changes in `project-preview`.
RFCs are lightweight, agent-legible specs that explain what we are changing, why it matters, and how success is verified.

## Lifecycle

- **Proposed**: draft or under review, located in `docs/rfcs/proposed/`
- **Implemented**: shipped, located in `docs/rfcs/done/`
- **Parked**: deferred, located in `docs/rfcs/parked/`
- **Superseded**: replaced by a newer RFC (usually moved to `docs/rfcs/superseded/`)

## When RFC is Required

RFC is required for non-trivial changes, including:

- New feature or major workflow change
- New integration or external dependency pattern
- Refactor spanning multiple modules or layers
- Behavior changes that require migration, rollout, or explicit acceptance criteria

RFC is optional for small bug fixes, typo/docs-only changes, and narrowly scoped maintenance updates.

## Numbering and Naming

- Filename format: `RFC-XXX-short-kebab-title.md`
- `XXX` is zero-padded (`001`, `002`, ...)
- Keep one RFC per decision scope
- Use `RFC-000-template.md` as the starting scaffold for new RFCs

## Required RFC Metadata

Every RFC must include:

- `Status`
- `Created`
- `Owner`

## RFC Registry

| RFC     | Status      | Location                                                          | Summary                                     |
| ------- | ----------- | ----------------------------------------------------------------- | ------------------------------------------- |
| RFC-000 | Proposed    | `docs/rfcs/proposed/RFC-000-roadmap.md`                           | Roadmap                                     |
| RFC-001 | Proposed    | `docs/rfcs/proposed/RFC-001-agentic-testing.md`                   | Agentic Testing Principles                  |
| RFC-002 | Parked      | `docs/rfcs/parked/RFC-002-standalone-browser-ui.md`               | Standalone Browser UI                       |
| RFC-003 | Implemented | `docs/rfcs/done/RFC-003-single-server-architecture.md`            | Single Server Architecture                  |
| RFC-004 | Proposed    | `docs/rfcs/proposed/RFC-004-mcp-apps-ui.md`                       | MCP Apps UI — original design intent        |
| RFC-005 | Proposed    | `docs/rfcs/proposed/RFC-005-mcp-session-security.md`              | MCP Session Security                        |
| RFC-006 | Implemented | `docs/rfcs/done/RFC-006-mcp-data-handling.md`                     | MCP Data Handling                           |
| RFC-007 | Implemented | `docs/rfcs/done/RFC-007-multi-session-http.md`                    | Multi-Session HTTP Architecture             |
| RFC-008 | Implemented | `docs/rfcs/done/RFC-008-sqlite-support.md`                        | SQLite Support                              |
| RFC-009 | Implemented | `docs/rfcs/done/RFC-009-headless-mcp-server.md`                   | Headless MCP Server                         |
| RFC-010 | Implemented | `docs/rfcs/done/RFC-010-connection-profiles.md`                   | Modular Connection Profiles                 |
| RFC-011 | Implemented | `docs/rfcs/done/RFC-011-node-independence-and-feature-flags.md`   | Node.js Independence and Feature Flags      |
| RFC-012 | Implemented | `docs/rfcs/done/RFC-012-pluggable-connectors.md`                  | Pluggable Connector Architecture            |
| RFC-013 | Implemented | `docs/rfcs/done/RFC-013-agentic-mcp-connectors.md`                | Agentic MCP-Based Pluggable Connectors      |
| RFC-014 | Implemented | `docs/rfcs/done/RFC-014-realtime-websocket.md`                    | Realtime Websocket Interface                |
| RFC-015 | Proposed    | `docs/rfcs/proposed/RFC-015-long-lived-connector-subprocesses.md` | Long-Lived Connector Subprocesses           |
| RFC-016 | Proposed    | `docs/rfcs/proposed/RFC-016-schema-metadata-api.md`               | Schema Metadata API                         |
| RFC-017 | Proposed    | `docs/rfcs/proposed/RFC-017-daemon-configuration.md`              | Daemon Configuration System                 |
| RFC-018 | Proposed    | `docs/rfcs/proposed/RFC-018-mcp-ui-refinement.md`                 | MCP App UI Refinement — P0                  |
| RFC-019 | Implemented | `docs/rfcs/done/RFC-019-mysql-connector.md`                       | MySQL / MariaDB Connector — P0              |
| RFC-020 | Proposed    | `docs/rfcs/proposed/RFC-020-mssql-connector.md`                   | SQL Server (MSSQL) Connector — P0           |
| RFC-021 | Proposed    | `docs/rfcs/proposed/RFC-021-snowflake-connector.md`               | Snowflake Connector — P0                    |
| RFC-022 | Proposed    | `docs/rfcs/proposed/RFC-022-bigquery-connector.md`                | BigQuery Connector — P0                     |
| RFC-023 | Proposed    | `docs/rfcs/proposed/RFC-023-distribution-claude-desktop.md`       | NPM Distribution & Claude Desktop — P0      |
| RFC-024 | Proposed    | `docs/rfcs/proposed/RFC-024-connector-testing-standards.md`       | Connector Testing Standards & Retrofit — P0 |
| RFC-025 | Proposed    | `docs/rfcs/proposed/RFC-025-clean-architecture-refactor.md`       | Clean Architecture Refactor (Logger DI)     |
| RFC-026 | Proposed    | `docs/rfcs/proposed/RFC-026-context-aware-toolsets.md`            | Context-Aware Toolsets (MCP Profiles)       |
| RFC-027 | Proposed    | `docs/rfcs/proposed/RFC-027-trino-connector.md`                   | Trino Connector Migration                   |

---

## P0 Launch Roadmap

These are the minimum changes required to market SQL Preview to companies using Claude Desktop and other MCP clients. P0 is the gate to any marketing activity.

### P0 RFC Set

| RFC     | Title                             | Effort | Unblocked by                  |
| ------- | --------------------------------- | ------ | ----------------------------- |
| RFC-016 | Schema Metadata API               | Medium | RFC-012 ✅, RFC-013 ✅        |
| RFC-018 | MCP App UI Refinement             | Medium | RFC-004 (partial) ✅, RFC-016 |
| RFC-019 | MySQL Connector                   | Low    | RFC-012 ✅, RFC-016           |
| RFC-020 | SQL Server Connector              | Medium | RFC-012 ✅, RFC-016           |
| RFC-021 | Snowflake Connector               | Medium | RFC-012 ✅, RFC-016           |
| RFC-022 | BigQuery Connector                | Medium | RFC-012 ✅, RFC-016           |
| RFC-023 | NPM Distribution & Claude Desktop | Low    | RFC-009 ✅, RFC-018, RFC-016  |
| RFC-024 | Connector Testing Standards       | Medium | RFC-019 ✅ (template done)    |

### Interdependency Graph

```
RFC-012 (Pluggable Connectors) ──────────────────┐
RFC-013 (Out-of-Process Connectors) ──────────────┤
RFC-010 (Connection Profiles) ────────────────────┤
         [All Implemented ✅]                      │
                                                   │
                                                   ▼
                                         RFC-016 (Schema Metadata API)
                                                   │
                    ┌──────────────────────────────┤
                    │                              │
                    ▼                              ▼
          RFC-019 (MySQL)            RFC-018 (MCP UI Refinement)
          RFC-020 (MSSQL)                          │
          RFC-021 (Snowflake)                      │
          RFC-022 (BigQuery)                       │
                    │                              │
                    └──────────────────────────────┘
                                   │
                                   ▼
                         RFC-023 (Distribution &
                          Claude Desktop Setup)
                                   │
                                   ▼
                           🚀 Marketing Ready
```

### Dependency Rules

1.  **RFC-016 is the critical path** — all connector RFCs (019–022) and the UI RFC (018) require schema metadata methods to be defined first. RFC-016 defines `IConnector` interface extensions; connectors implement them.

2.  **Connectors (019–022) are parallel** — once RFC-016 types are defined, all four connector packages can be built simultaneously by separate engineers.

3.  **RFC-018 (UI) depends on RFC-016** — the Connections CRUD form in the MCP App needs to know which connector types exist and what fields they require.

4.  **RFC-023 (Distribution) is last** — it depends on RFC-018 (so the MCP App bundle is polished) and on at least RFC-019 being done (so there's a meaningful second connector to demonstrate beyond Postgres).

### What Already Exists (No RFC Needed)

These features are implemented and do **not** require new RFCs before marketing:

- Trino, Postgres, SQLite, DuckDB connectors (`packages/sql-preview-*`)
- Daemon + SSE/WebSocket/Streamable HTTP transports
- Connection profile persistence (`~/.sql-preview/config.json`)
- `SQL_PREVIEW_CONNECTIONS` environment variable
- VS Code extension (query execution, AG Grid results view, code lens)
- `run_query`, `list_connections`, `test_connection` MCP tools
- Standalone server entry point (`out/server/standalone.js`)
