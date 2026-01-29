# RFC-002: Standalone Browser UI for Claude Code Integration

**Status**: Proposed
**Created**: 2026-01-28

## Goal

Enable SQL Preview to be used with Claude Code (or any MCP client) outside of VS Code/Cursor by creating a standalone server with a browser-based results UI.

## Problem Statement

Currently, SQL Preview is tightly coupled to VS Code:

- The MCP server only runs when the VS Code extension is active
- Query results are displayed in a VS Code webview
- Configuration is stored in VS Code settings

This limits usage to scenarios where the user has VS Code open. Users of Claude Code in a standalone terminal cannot:

1. Execute SQL queries via the MCP tools
2. View query results in a visual data grid

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  sql-preview-server (standalone Node.js process)           │
│                                                             │
│  ┌───────────────┐        ┌────────────────────────────┐   │
│  │  MCP Server   │        │  HTTP Server               │   │
│  │  (stdio)      │        │  - Static UI files         │   │
│  │               │        │  - REST API                │   │
│  │  Tools:       │        │  - WebSocket (live push)   │   │
│  │  - run_query  │        │                            │   │
│  │  - list_tabs  │        │  Endpoints:                │   │
│  │  - get_tab    │        │  GET  /           → UI     │   │
│  │               │        │  GET  /api/tabs   → JSON   │   │
│  │               │        │  WS   /ws         → push   │   │
│  └───────┬───────┘        └─────────────┬──────────────┘   │
│          │                              │                   │
│          └──────────┬───────────────────┘                   │
│                     ▼                                       │
│          ┌─────────────────────┐                            │
│          │   Core Engine       │                            │
│          │   - QueryExecutor   │                            │
│          │   - ResultsStore    │                            │
│          │   - TabManager      │                            │
│          └──────────┬──────────┘                            │
│                     │                                       │
│          ┌─────────────────────┐                            │
│          │   Connectors        │                            │
│          │   - Trino           │                            │
│          │   - PostgreSQL      │                            │
│          │   - SQLite          │                            │
│          └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
    Claude Code                    Browser Window
    (stdio MCP)                    http://localhost:3000
```

## Components

### 1. Package Structure

```
sql-preview/
├── src/                              # Existing VS Code extension
├── packages/
│   ├── core/                         # Shared core (extracted)
│   │   ├── connectors/
│   │   │   ├── base/
│   │   │   │   ├── IConnector.ts
│   │   │   │   └── ConnectorRegistry.ts
│   │   │   ├── trino/
│   │   │   ├── postgres/
│   │   │   └── sqlite/
│   │   ├── execution/
│   │   │   └── QueryExecutor.ts
│   │   ├── store/
│   │   │   ├── TabManager.ts
│   │   │   └── ResultsStore.ts
│   │   └── index.ts
│   │
│   ├── mcp-server/                   # Standalone MCP server
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point (stdio + HTTP)
│   │   │   ├── McpHandler.ts         # MCP tool definitions
│   │   │   ├── HttpServer.ts         # Express server
│   │   │   ├── WebSocketManager.ts   # Live updates
│   │   │   └── ConfigLoader.ts       # File/env config
│   │   ├── bin/
│   │   │   └── sql-preview-server    # CLI entry
│   │   └── package.json
│   │
│   └── web-ui/                       # Browser UI
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── ResultsGrid.tsx   # AG Grid wrapper
│       │   │   ├── TabBar.tsx
│       │   │   ├── Toolbar.tsx
│       │   │   └── StatusBar.tsx
│       │   ├── hooks/
│       │   │   ├── useWebSocket.ts
│       │   │   └── useTabs.ts
│       │   └── styles/
│       │       └── theme.css
│       ├── index.html
│       └── package.json
│
└── package.json                      # Workspace root
```

### 2. MCP Server (stdio transport)

The standalone server uses **stdio transport** instead of SSE, which is the preferred method for Claude Code CLI integration.

```typescript
// packages/mcp-server/src/index.ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpServer } from './HttpServer.js';
import { QueryExecutor } from '@sql-preview/core';

const server = new Server(
  { name: 'sql-preview', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } }
);

// Start HTTP server for browser UI
const httpServer = new HttpServer(queryExecutor, tabManager);
await httpServer.start(3000);

// Connect MCP via stdio
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 3. Configuration

Replace VS Code settings with a configuration file and environment variables:

```json
// ~/.sql-preview.json
{
  "connections": {
    "default": {
      "type": "trino",
      "host": "trino.example.com",
      "port": 443,
      "user": "analyst",
      "catalog": "hive",
      "schema": "default",
      "ssl": true
    },
    "local-pg": {
      "type": "postgres",
      "host": "localhost",
      "port": 5432,
      "user": "postgres",
      "database": "myapp"
    }
  },
  "defaultConnection": "default",
  "ui": {
    "port": 3000,
    "autoOpen": true,
    "maxRows": 10000
  },
  "safeMode": true
}
```

Environment variable overrides:

```bash
SQL_PREVIEW_HOST=trino.example.com
SQL_PREVIEW_USER=analyst
SQL_PREVIEW_PASSWORD=secret
SQL_PREVIEW_UI_PORT=3000
```

### 4. Browser UI

The web UI reuses the existing AG Grid implementation from the VS Code webview:

**Features:**

- Tabbed interface for multiple query results
- AG Grid with sorting, filtering, column resizing
- CSV export
- Copy to clipboard (cell, row, range)
- Dark/light theme support
- Real-time updates via WebSocket

**Communication Flow:**

```
┌─────────────┐     WebSocket      ┌─────────────┐
│  Browser    │ ◄────────────────► │  Server     │
│             │                    │             │
│  Events:    │                    │  Pushes:    │
│  - request  │                    │  - new_tab  │
│    tabs     │                    │  - update   │
│  - export   │                    │  - error    │
│  - copy     │                    │  - progress │
└─────────────┘                    └─────────────┘
```

### 5. MCP Tools

| Tool         | Description          | Parameters                                               |
| ------------ | -------------------- | -------------------------------------------------------- |
| `run_query`  | Execute SQL query    | `sql: string`, `connection?: string`, `newTab?: boolean` |
| `list_tabs`  | List all result tabs | none                                                     |
| `get_tab`    | Get tab data by ID   | `tabId: string`                                          |
| `close_tab`  | Close a result tab   | `tabId: string`                                          |
| `export_csv` | Export tab to CSV    | `tabId: string`, `path: string`                          |

### 6. Auto-Open Browser

When a query completes, optionally open the results in the default browser:

```typescript
import open from 'open';

if (config.ui.autoOpen) {
  await open(`http://localhost:${config.ui.port}?tab=${tabId}`);
}
```

## User Experience

### Installation

```bash
# Install globally
npm install -g @sql-preview/server

# Or use npx
npx @sql-preview/server
```

### Usage with Claude Code

```bash
# Add MCP server to Claude Code
claude mcp add sql-preview -- sql-preview-server

# Or with npx
claude mcp add sql-preview -- npx @sql-preview/server
```

### Typical Session

```bash
# Terminal: Start Claude Code
$ claude

You: Show me the top 10 customers by revenue from the analytics database

# Claude calls run_query tool via MCP
# Browser opens http://localhost:3000 with results
# Claude receives data and can discuss it

Claude: Here are the top 10 customers by revenue:
| customer_id | name           | total_revenue |
|-------------|----------------|---------------|
| 1042        | Acme Corp      | $2,450,000    |
| ...         | ...            | ...           |

The results are also visible in your browser at http://localhost:3000
```

## Migration Path

### Phase 1: Extract Core

1. Move connectors to `packages/core/connectors/`
2. Move `QueryExecutor` to `packages/core/execution/`
3. Create `TabManager` that works without VS Code
4. Update VS Code extension to import from `@sql-preview/core`

### Phase 2: Standalone MCP Server

1. Create `packages/mcp-server/` with stdio transport
2. Implement configuration loader (file + env vars)
3. Add HTTP server for REST API
4. Implement WebSocket for live updates

### Phase 3: Browser UI

1. Create `packages/web-ui/` with Vite + React
2. Port AG Grid setup from `webviews/results/`
3. Implement WebSocket client
4. Add theme support (reuse existing CSS variables)

### Phase 4: Polish & Publish

1. Add CLI argument parsing (`--port`, `--config`, `--no-ui`)
2. Add connection testing command
3. Write documentation
4. Publish to npm as `@sql-preview/server`

## Alternatives Considered

### 1. Keep SSE Transport Only

**Rejected**: SSE is deprecated in MCP spec. Claude Code works better with stdio for local tools.

### 2. Electron App

**Deferred**: Adds significant complexity. Browser UI is simpler and sufficient for most use cases.

### 3. Terminal UI (TUI)

**Deferred**: Could be added later using `blessed` or `ink`. Data tables are better visualized in a browser with AG Grid.

### 4. VS Code Server (Remote)

**Rejected**: Requires VS Code infrastructure. Goal is to be fully standalone.

## Open Questions

1. **Authentication**: How to handle database passwords securely without VS Code SecretStorage?
   - Option A: System keychain via `keytar`
   - Option B: Environment variables only
   - Option C: Prompt on first use, store encrypted locally

2. **Multiple Instances**: How to handle multiple Claude Code sessions?
   - Option A: Single shared server (port locking)
   - Option B: Each session spawns its own server on different port

3. **Query History**: Should we persist query history across sessions?
   - Option A: In-memory only
   - Option B: SQLite local database
   - Option C: Configurable

## Recommendation

Start with **Phase 1 (Extract Core)** as it benefits the existing VS Code extension by improving modularity. Then proceed to Phase 2-3 in parallel (MCP server + UI can be developed concurrently).

Target timeline: Implementation can begin immediately, with core extraction being the lowest-risk first step.
