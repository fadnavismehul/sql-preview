# RFC-013: Agentic MCP-Based Pluggable Connectors

**Feature Name:** Agentic MCP-Based Pluggable Connectors
**Status:** Implemented
**Created:** 2026-02-26
**Owner:** Core Team

## Summary

This RFC proposes a shift in the architecture for Pluggable Connectors (introduced in RFC-012). Instead of dynamically installing and loading Node.js connector packages directly into the Daemon process using NPM, we propose an **Out-of-Process Architecture** using the Model Context Protocol (MCP) or standard gRPC/stdio. Each connector will function as a standalone server, and the Daemon will act as a client routing queries to these connector servers.

## Motivation

RFC-012 successfully defined the boundaries for connectors by extracting them into distinct packages (`@sql-preview/connector-api`, `sql-preview-duckdb`, etc.). However, the runtime deployment mechanism relies on `cp.spawn('npm install ...')` to fetch and load these plugins dynamically into the main Node.js process. This poses critical barriers for our goal of a fully agentic, headless, and standalone system:

1. **Dependency on Host Machine Tooling:** A truly standalone environment (e.g., lightweight containers, locked-down CI/CD runners, bundled desktop apps) cannot assume `npm` or `node` are available system-wide.
2. **Security & Sandboxing:** In an agent-first system, AI agents might autonomously handle connection profiles. Downloading and blindly `require()`ing arbitrary npm packages inside the main Daemon process is a critical Remote Code Execution (RCE) risk.
3. **Process Stability:** Connectors that crash (e.g., a DuckDB native segfault) currently bring down the entire Daemon, terminating all active sessions.
4. **Latency:** Dynamically fetching packages over the network during query execution introduces severe latency spikes unacceptable for autonomous API boundaries.
5. **Language Agnosticism:** Connectors are currently forced to be Node.js packages. A standalone protocol allows high-performance connectors written in Rust, Go, or Python.

## Proposed Architecture

We will pivot to an **Out-of-Process Architecture** powered by the **Model Context Protocol (MCP)**.

### 1. Connectors as MCP Servers or CLIs

Each connector (PostgreSQL, SQLite, DuckDB) will be bundled as a standalone executable. These executables can operate in two modes:

- **MCP Server Mode:** Running continuously and communicating via stdio or HTTP/SSE using the Model Context Protocol.
- **CLI Mode:** A standard command-line interface (e.g., `sql-preview-duckdb "SELECT * FROM users"`). This is particularly powerful for autonomous agents, which frequently rely on standard shell environments and CLIs to interact with tools rather than complex RPC protocols.

### 2. The Daemon as an Orchestrator

The main SQL Preview Daemon will act as an orchestrator.

- When a `custom` profile is invoked, instead of `npm install`, the Daemon will spawn the configured connector executable (e.g., `./connectors/sqlite-mcp-server`) or invoke it as a one-shot CLI command.
- Native agents (like an AI in a terminal) can bypass the Daemon entirely and just use the CLI binaries provided by the connectors.

### 3. Distribution

- Built-in connectors (DuckDB, SQLite) will be pre-bundled as executables or sub-processes alongside the standalone Daemon.
- Custom connectors can be provided by users as explicit executable paths in their configuration (`connectorPath: "/path/to/my-connector"`), rather than relying on dynamic NPM resolution.

## Implementation Steps

1. **Dual-Mode Executables:** Update the extracted connectors (`sql-preview-duckdb`, etc.) to build as standalone binaries (using tools like `pkg` or `esbuild` + `node`). They should accept a `--mcp` flag to start as a server, or standard arguments to run as a CLI query tool.
2. **Define the Protocol:** Map the existing `IConnector` methods (`runQuery`, `validateConfig`) to MCP capabilities (e.g., `tools/call`, pagination resources) for the server mode.
3. **Adapter Layer:** Create a `SubProcessConnectorClient` in the generic Daemon that implements `IConnector` but forwards the calls either over MCP to a child process, or via standard CLI execution.
4. **Daemon Spawn Logic:** Replace the `DriverManager`'s `npm install` logic with a robust process manager that spawns the correct connector executable based on the connection profile.
5. **Security Boundaries:** Enforce strict allow-lists for executable paths to prevent arbitrary command execution by agents.

## Alternatives Considered

- **WASM Modules:** Compiling connectors to WebAssembly (WASI) and running them in isolated sandboxes. _Pros:_ Extremely secure, language-agnostic. _Cons:_ Not all databases have robust WASM drivers (e.g., PostgreSQL native wire protocols are hard to compile to WASM without workarounds). MCP standardizes on processes which are easier to author today.
- **Staying with NPM (Status Quo):** Accept the limitations of RFC-012. _Cons:_ Precludes true standalone deployment and poses significant security risks in agentic workflows.

## Resolved Questions

- **Distribution of Custom Third-Party Connectors:**
  - **Resolution:** We will adopt a "Bring Your Own Binary" (BYOB) model. Users or agents will download the standalone connector executable (e.g., from GitHub Releases) and provide the absolute path in the `connectorPath` field of their Connection Profile. For verified community connectors, we can maintain a registry/CDN from which the Daemon or Agent can securely download the binary matching their OS/Architecture, verifying checksums before execution.
- **Handling Heavy Streaming of Large Datasets:**
  - **Resolution:** While MCP over stdio (JSON-RPC) is sufficient for most agentic probing and pagination, it is inefficient for gigabyte-scale exports. We will support a secondary "Data Channel" approach. The connector can write massive datasets (like Parquet or Apache Arrow IPC streams) to a temporary local file or named pipe, and pass the file URI back to the Daemon/Agent via MCP. The Daemon can then read the binary file directly, bypassing JSON serialization overhead entirely.
