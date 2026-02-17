# RFC-005: Generic Data Viewer & DuckDB Integration

**Status**: Implemented
**Created**: 2026-02-16
**Updated**: 2026-02-17
**Implementation PR**: (Feature Branch `feat/mcp-duckdb-integration`)

## Goal

Transform the SQL Preview MCP Server into a **Generic Data Powerhouse** optimized for LLM-based interactions by enabling "SQL for Everything". This allows LLMs to query various data sources (CSVs, JSON, Logs) using a unified SQL interface backed by **DuckDB**.

## Problem Statement

1.  **Source Limitation**: Previously optimized only for Trino/Presto. No easy way to analyze local files or ad-hoc data without a full database setup.
2.  **Missed LLM Potential**: LLMs are excellent at writing SQL. We were underutilizing this capability by not giving them a fast, local execution engine for arbitrary data.

## Solution: The "SQL for Everything" Engine (DuckDB)

We incorporated **DuckDB** as the core local processing engine via the `@duckdb/node-api`.

### Key Features

1.  **Unified Interface**: To the LLM, everything looks like a table.
    - _Files_: `SELECT * FROM 'data.csv'`
    - _APIs_: Data fetched from APIs can be loaded into DuckDB memory.
2.  **Native Integration**: Implemented as a standard `IConnector` within the `Daemon`.
3.  **Zero-Setup**: Uses in-memory processing (`:memory:`) or local file mounting.

## Architecture Changes

1.  **DuckDB Connector**:
    - Created `DuckDbConnector` implementing `IConnector`.
    - Used `@duckdb/node-api` for robust Node.js integration.
    - Handles pagination/streaming to fit the existing UI model (Results Grid).
2.  **Daemon Integration**:
    - Registered `DuckDbConnector` in `ConnectorRegistry`.
    - Available alongside Trino/Presto within the same session.

## Result

Agents can now request:

```sql
SELECT * FROM '/path/to/local/file.csv' LIMIT 10
```

And receive structured results immediately, without requiring an external database server.
