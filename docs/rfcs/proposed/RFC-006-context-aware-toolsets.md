# RFC-006: Context-Aware Toolsets (Modular MCP Architecture)

**Status**: Proposed
**Created**: 2026-02-17
**Related**: RFC-005 (Generic Data Viewer)

## Goal

Modularize the MCP tool exposures to support different contexts (VS Code UI vs. Headless Agents). The goal is to allow the SQL Preview server to adapt its capabilities based on the environment it runs in.

## Problem Statement

1.  **Tool Rigidity**: The current `run_query` tool is heavily tied to the VS Code "Tabs" UI model (async execution, visual results). This is suboptimal for headless agents that need synchronous data return and don't care about UI tabs.
2.  **Context Mismatch**: Agents running in a CLI or background process need different tools (e.g., direct schema inspection) than a user exploring data interactively in VS Code.

## Proposal

### Modular Toolsets (Context-Aware Profiles)

We will introduce the concept of **Tool Profiles** to the `DaemonMcpToolManager`. The server will expose different sets of tools depending on the detected context or configuration.

#### Profile A: `vscode` (Current/Enhanced)

_Target: Human-in-the-loop, interactive exploration._

- **Tools**:
  - `run_query(sql, session_id)`: Async, opens a UI tab, returns "Query started".
  - `get_tab_info(...)`: Polls for status/results.
- **UX**: User sees grids, charts, and persistent tabs.

#### Profile B: `headless` (Agentic/CLI)

_Target: Autonomous LLM Agents (e.g., in a terminal or background process)._

- **Tools**:
  - `run_sql(sql)`: Synchronous. Returns standard JSON array of objects.
  - `read_resource(uri)`: Direct data access.
  - `inspect_schema(source)`: returns DDL/Schema info.
- **UX**: Fast, stateless (or session-less) data retrieval. No UI overhead.

#### Profile C: `hybrid` (The Vision)

Allows an agent to _choose_ execution mode:

- "Run this analysis and show me" -> Uses UI mode.
- "Calculate the average and tell me" -> Uses Headless mode.

## Architecture Changes

1.  **Refactor `DaemonMcpToolManager`**:
    - Introduce `IToolSet` interface.
    - Implement `VsCodeToolSet` and `HeadlessToolSet`.
    - Add logic to select ToolSet at startup (env var `MCP_PROFILE`) or via dynamic negotiation.

## Roadmap

1.  **Design**: Define `IToolSet` interface.
2.  **Implementation**: Create `HeadlessToolSet` with synchronous SQL execution.
3.  **Integration**: Update `DaemonMcpToolManager` to load profiles based on config.
