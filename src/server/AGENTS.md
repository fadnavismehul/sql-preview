# Server & Daemon Architecture

> **Context**: This module runs as a separate Node.js process spawned by the VS Code extension. It handles all "heavy lifting" including database connections, query execution, and the MCP (Model Context Protocol) server.

## 🗺️ Map

- **[Daemon.ts](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/server/Daemon.ts)**: The entry point. Initializes the `DaemonMcpServer` and manages the process lifecycle.
- **[DaemonMcpServer.ts](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/server/DaemonMcpServer.ts)**: The core MCP server implementation. Routes tool calls and resource requests.
- **[DaemonMcpToolManager.ts](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/server/DaemonMcpToolManager.ts)**: Registers and handles execution of MCP tools (e.g., `run_query`, `list_tables`).
- **[SessionManager.ts](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/server/SessionManager.ts)**: Manages stateful sessions, mapping persistent IDs to connection states.
- **[DaemonQueryExecutor.ts](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/server/DaemonQueryExecutor.ts)**: wrapper around `QueryExecutor` to run queries in the daemon context.
- **[ConnectionManager.ts](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/server/connection/ConnectionManager.ts)**: Orchestrates connection profiles and credentials from multiple stores (File, Env, Memory).

## 🔄 Data Flow

1.  **Startup**: extension spawns `Daemon.ts` with stdio pipe.
2.  **Handshake**: Extension and Daemon perform an MCP handshake to establish capabilities.
3.  **Tool Call**:
    - Agent/User requests `run_query`.
    - `DaemonMcpServer` receives request via `SocketTransport` (or stdio).
    - `DaemonMcpToolManager` validates arguments and invokes the tool.
    - `DaemonQueryExecutor` runs the query via a Connector.
    - Results are returned as an MCP `CallToolResult`.

## ⚠️ Key Constraints

- **No VS Code API**: This process **cannot** import `vscode`. It is a standard Node.js process.
- **Node.js Independence**: The daemon is spawned such that it can run using the system `node` OR fall back to the VS Code bundled runtime (`process.execPath`) if system node is missing.
- **Statelessness**: While `SessionManager` holds state, the process should be robust to restarts.
- **security**: Credentials are passed securely via the `connect` tool or environment variables, never logged.
