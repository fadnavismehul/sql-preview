# RFC-004: MCP Apps Integration for Inline Query Results

**Status**: Implemented
**Created**: 2026-01-28

## Goal

Implement MCP Apps support so SQL query results render as an **interactive AG Grid directly inside the conversation** in Claude Desktop, Claude Web, and other MCP Apps-compatible hosts.

## Why This Matters

Currently, when Claude Code or Claude Desktop calls our `run_query` tool, users see:

```
Query returned 142 rows.
| id | customer | revenue    |
|----|----------|------------|
| 1  | Acme     | $2,450,000 |
| 2  | Globex   | $1,890,000 |
... (plain text, no interaction)

View interactive results at http://localhost:8414
```

Users must leave the conversation, open a browser, and lose context. With MCP Apps:

```
Query returned 142 rows.
┌─────────────────────────────────────────────────────────────┐
│  [Interactive AG Grid embedded in conversation]             │
│  - Click headers to sort                                    │
│  - Filter, resize columns                                   │
│  - Copy cells, export CSV                                   │
│  - All without leaving the chat                             │
└─────────────────────────────────────────────────────────────┘
```

The results live where the conversation happens. Users can ask follow-up questions while looking at the data. This is the experience we want.

## How MCP Apps Work

MCP Apps is an extension to the MCP protocol that allows tools to return interactive HTML UIs that render in sandboxed iframes within the host application.

### The Protocol Flow

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│    Claude    │         │  SQL Preview │         │   UI Bundle  │
│    (Host)    │         │  MCP Server  │         │   (HTML/JS)  │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       │  1. Initialize         │                        │
       │───────────────────────>│                        │
       │                        │                        │
       │  2. List tools         │                        │
       │───────────────────────>│                        │
       │                        │                        │
       │  3. Return tools with  │                        │
       │     _meta.ui.resourceUri                        │
       │<───────────────────────│                        │
       │                        │                        │
       │  4. User: "show top customers"                  │
       │  5. LLM decides to call run_query               │
       │                        │                        │
       │  6. Call run_query     │                        │
       │───────────────────────>│                        │
       │                        │                        │
       │  7. Execute SQL        │                        │
       │                        │                        │
       │  8. Return result +    │                        │
       │     columns/rows data  │                        │
       │<───────────────────────│                        │
       │                        │                        │
       │  9. Fetch UI resource  │                        │
       │───────────────────────>│                        │
       │                        │                        │
       │  10. Return bundled HTML                        │
       │<───────────────────────│                        │
       │                        │                        │
       │  11. Render iframe     │                        │
       │─────────────────────────────────────────────────>
       │                        │                        │
       │  12. Push tool result to iframe via postMessage │
       │─────────────────────────────────────────────────>
       │                        │                        │
       │  13. UI renders AG Grid with data               │
       │                        │                        │
       │  14. User clicks "Re-run Query" in UI           │
       │<─────────────────────────────────────────────────
       │                        │                        │
       │  15. Proxy tool call   │                        │
       │───────────────────────>│                        │
       │                        │                        │
       │  16. Fresh results     │                        │
       │<───────────────────────│                        │
       │                        │                        │
       │  17. Push to UI        │                        │
       │─────────────────────────────────────────────────>
```

### Key Concepts

**Tool with UI metadata**: The tool declares a `_meta.ui.resourceUri` field:

```typescript
{
  name: "run_query",
  description: "Execute SQL query and display results",
  inputSchema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "SQL query to execute" },
      connection: { type: "string", description: "Connection profile name" }
    },
    required: ["sql"]
  },
  _meta: {
    ui: {
      resourceUri: "ui://sql-preview/results-grid"
    }
  }
}
```

**UI Resource**: The server serves a bundled HTML/JS file when the host requests `ui://sql-preview/results-grid`:

```typescript
// When host requests the UI resource
{
  contents: [
    {
      uri: 'ui://sql-preview/results-grid',
      mimeType: 'text/html;profile=mcp-app',
      text: '<html>...bundled AG Grid app...</html>',
    },
  ];
}
```

**App class**: The UI uses `@modelcontextprotocol/ext-apps` to communicate with the host:

```typescript
import { App } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'SQL Preview', version: '1.0.0' });
app.connect();

// Receive query results when tool is called
app.ontoolresult = result => {
  const { columns, rows, query, executionTime } = result.data;
  renderGrid(columns, rows);
};

// User clicks "Re-run" button
async function rerunQuery(sql: string) {
  const result = await app.callServerTool({
    name: 'run_query',
    arguments: { sql },
  });
  renderGrid(result.data.columns, result.data.rows);
}
```

### Security Model

MCP Apps run in sandboxed iframes with restricted permissions:

- Cannot access parent window's DOM or cookies
- All communication via postMessage (abstracted by App class)
- Host controls which capabilities the app can access
- CSP can restrict which external domains the app loads resources from

For SQL Preview, we don't need any special permissions - we're just displaying data.

## Architecture

### Project Structure

```
sql-preview/
├── src/
│   ├── extension.ts                    # VS Code extension (existing)
│   ├── server/
│   │   ├── Daemon.ts                   # Existing Daemon entry point
│   │   ├── McpServer.ts                # Existing server logic
│   │   ├── McpToolManager.ts           # Existing tool definitions
│   │   └── McpAppsServer.ts            # NEW: Streamable HTTP server with UI resources
│   │
│   ├── mcp-app/                        # NEW: MCP App UI
│   │   ├── index.html                  # Entry point
│   │   ├── App.tsx                     # Main React component
│   │   ├── components/
│   │   │   ├── ResultsGrid.tsx         # AG Grid wrapper
│   │   │   ├── Toolbar.tsx             # Export, copy, re-run buttons
│   │   │   ├── QueryInfo.tsx           # Shows query text, timing
│   │   │   └── StatusBar.tsx           # Row count, connection info
│   │   ├── hooks/
│   │   │   └── useMcpApp.ts            # App class wrapper
│   │   └── styles/
│   │       └── theme.css               # Matches host theme
│   │
│   ├── services/
│   │   └── ServiceContainer.ts         # Existing Service Container
│   │
│   └── ui/                             # Existing Webview UI
│
├── vite.config.mcp-app.ts              # NEW: Builds single-file HTML bundle
└── package.json
```

### Server Implementation

We'll create a new `McpAppsServer` that uses Streamable HTTP transport (the modern approach) and registers UI resources:

```typescript
// src/server/McpAppsServer.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

export class McpAppsServer {
  private server: McpServer;
  private app: express.Express;

  constructor(private queryExecutor: QueryExecutor) {
    this.server = new McpServer({
      name: 'sql-preview',
      version: '1.0.0',
    });

    this.setupTools();
    this.setupResources();
    this.app = express();
  }

  private setupTools() {
    const resourceUri = 'ui://sql-preview/results-grid';

    // Register run_query with UI metadata
    registerAppTool(
      this.server,
      'run_query',
      {
        title: 'Run SQL Query',
        description: 'Execute a SQL query and display results in an interactive grid',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'SQL query to execute' },
            connection: { type: 'string', description: 'Connection profile name (optional)' },
          },
          required: ['sql'],
        },
        _meta: { ui: { resourceUri } },
      },
      async params => {
        const { sql, connection } = params;

        // Execute query using existing infrastructure
        const result = await this.queryExecutor.execute(sql, connection);

        return {
          content: [
            {
              type: 'text',
              text: `Query returned ${result.rowCount} rows in ${result.executionTime}ms`,
            },
          ],
          // Data passed to the UI
          data: {
            query: sql,
            columns: result.columns,
            rows: result.rows,
            rowCount: result.rowCount,
            executionTime: result.executionTime,
            connection: connection || 'default',
          },
        };
      }
    );

    // List available connections (no UI needed)
    this.server.tool(
      'list_connections',
      'List available database connection profiles',
      {},
      async () => {
        const connections = await this.getConnections();
        return {
          content: [{ type: 'text', text: JSON.stringify(connections, null, 2) }],
        };
      }
    );
  }

  private setupResources() {
    const resourceUri = 'ui://sql-preview/results-grid';

    registerAppResource(
      this.server,
      resourceUri,
      resourceUri,
      {
        mimeType: RESOURCE_MIME_TYPE,
        _meta: {
          ui: {
            // CSP: We need AG Grid from CDN if not bundled
            // If fully bundled, this can be empty
            csp: {
              connectDomains: [], // No external API calls needed
              resourceDomains: [], // Everything bundled
            },
          },
        },
      },
      async () => {
        // Read the bundled HTML file
        const html = await fs.readFile(path.join(__dirname, '../../dist/mcp-app.html'), 'utf-8');
        return {
          contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
        };
      }
    );
  }

  async start(port: number = 8414) {
    this.app.use(express.json());

    // MCP endpoint
    this.app.post('/mcp', async (req, res) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => transport.close());
      await this.server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    this.app.listen(port, '127.0.0.1', () => {
      console.log(`MCP Apps Server listening on http://127.0.0.1:${port}/mcp`);
    });
  }
}
```

### UI Implementation

The UI is a React app that uses AG Grid and communicates via the `App` class:

```typescript
// src/mcp-app/App.tsx
import { useEffect, useState, useCallback } from 'react';
import { App as McpApp } from '@modelcontextprotocol/ext-apps';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

interface QueryResult {
  query: string;
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  executionTime: number;
  connection: string;
}

export function App() {
  const [mcpApp] = useState(() => new McpApp({
    name: 'SQL Preview',
    version: '1.0.0'
  }));
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    // Connect to host
    mcpApp.connect();

    // Receive initial tool result
    mcpApp.ontoolresult = (toolResult) => {
      if (toolResult.data) {
        setResult(toolResult.data as QueryResult);
        setError(null);
      }
    };

    // Handle theme changes from host
    mcpApp.onhostcontextchanged = (context) => {
      if (context.theme) {
        setTheme(context.theme === 'dark' ? 'dark' : 'light');
      }
    };

    // Get initial theme
    const hostContext = mcpApp.getHostContext();
    if (hostContext?.theme) {
      setTheme(hostContext.theme === 'dark' ? 'dark' : 'light');
    }

    return () => mcpApp.close();
  }, [mcpApp]);

  const rerunQuery = useCallback(async () => {
    if (!result?.query) return;

    setLoading(true);
    setError(null);

    try {
      const newResult = await mcpApp.callServerTool({
        name: 'run_query',
        arguments: {
          sql: result.query,
          connection: result.connection,
        },
      });

      if (newResult.data) {
        setResult(newResult.data as QueryResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  }, [mcpApp, result]);

  const exportCsv = useCallback(() => {
    if (!result) return;

    const headers = result.columns.map(c => c.name).join(',');
    const rows = result.rows.map(row =>
      result.columns.map(c => JSON.stringify(row[c.name] ?? '')).join(',')
    ).join('\n');

    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    // Request host to open download
    mcpApp.openLink({ url });
  }, [mcpApp, result]);

  const columnDefs = result?.columns.map(col => ({
    field: col.name,
    headerName: col.name,
    sortable: true,
    filter: true,
    resizable: true,
  })) ?? [];

  return (
    <div className={`app ${theme === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}`}>
      {/* Toolbar */}
      <div className="toolbar">
        <span className="query-info">
          {result ? `${result.rowCount} rows · ${result.executionTime}ms` : 'No results'}
        </span>
        <div className="toolbar-actions">
          <button onClick={rerunQuery} disabled={loading || !result}>
            {loading ? 'Running...' : 'Re-run'}
          </button>
          <button onClick={exportCsv} disabled={!result}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && <div className="error">{error}</div>}

      {/* Grid */}
      {result && (
        <div className="grid-container">
          <AgGridReact
            columnDefs={columnDefs}
            rowData={result.rows}
            defaultColDef={{
              sortable: true,
              filter: true,
              resizable: true,
            }}
            enableCellTextSelection={true}
            ensureDomOrder={true}
          />
        </div>
      )}

      {/* Query preview */}
      {result && (
        <div className="query-preview">
          <code>{result.query}</code>
        </div>
      )}
    </div>
  );
}
```

### Build Configuration

Use Vite with `vite-plugin-singlefile` to bundle everything into one HTML file:

```typescript
// vite.config.mcp-app.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: 'src/mcp-app',
  build: {
    outDir: '../../dist',
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/mcp-app/index.html',
      output: {
        entryFileNames: 'mcp-app.js',
      },
    },
  },
});
```

The bundle will include:

- React (~40KB gzipped)
- AG Grid Community (~90KB gzipped)
- Our components (~5KB)
- Total: ~135KB (acceptable for inline rendering)

## Tool Definitions

### run_query (with UI)

The primary tool that executes queries and displays results in the inline grid.

```typescript
{
  name: "run_query",
  title: "Run SQL Query",
  description: "Execute a SQL query against the configured database and display results in an interactive grid. Supports sorting, filtering, and export.",
  inputSchema: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "The SQL query to execute"
      },
      connection: {
        type: "string",
        description: "Connection profile name. Uses default if not specified."
      }
    },
    required: ["sql"]
  },
  _meta: {
    ui: {
      resourceUri: "ui://sql-preview/results-grid"
    }
  }
}
```

### list_connections (no UI)

Simple text response, no interactive UI needed.

```typescript
{
  name: "list_connections",
  description: "List available database connection profiles",
  inputSchema: { type: "object", properties: {} }
}
```

### describe_table (with UI)

Could show schema information in a structured grid.

```typescript
{
  name: "describe_table",
  title: "Describe Table",
  description: "Show table schema including columns, types, and constraints",
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", description: "Table name (schema.table format supported)" }
    },
    required: ["table"]
  },
  _meta: {
    ui: {
      resourceUri: "ui://sql-preview/schema-viewer"
    }
  }
}
```

## UI Features

The inline grid should support:

| Feature           | Implementation                                    |
| ----------------- | ------------------------------------------------- |
| **Sorting**       | AG Grid built-in, click column headers            |
| **Filtering**     | AG Grid built-in, filter icon in headers          |
| **Column resize** | AG Grid built-in, drag column borders             |
| **Copy cells**    | AG Grid cell selection + Ctrl+C                   |
| **Export CSV**    | Custom button → blob download                     |
| **Re-run query**  | Custom button → `app.callServerTool()`            |
| **Theme sync**    | `app.onhostcontextchanged` → switch AG Grid theme |
| **Show query**    | Collapsible panel showing the executed SQL        |

## Deployment Options

### Option 1: Standalone Server (Claude Desktop / Claude Web)

For users connecting Claude to SQL Preview as a remote MCP server:

```bash
# Install globally
npm install -g @sql-preview/server

# Start server
sql-preview-server --port 8414

# Add to Claude as custom connector
# URL: https://<your-tunnel>/mcp  (via cloudflared or similar)
```

### Option 2: VS Code Extension (existing + enhanced)

The VS Code extension can start the MCP Apps server alongside the existing SSE server:

```typescript
// In extension activation
const mcpAppsServer = new McpAppsServer(queryExecutor);
await mcpAppsServer.start(8414);

// Now both work:
// - SSE at :8414/sse (existing, for Cursor/Claude Code stdio relay)
// - Streamable HTTP at :8414/mcp (for Claude Desktop with UI)
```

### Option 3: Claude Code with stdio

For Claude Code CLI users, we need a stdio wrapper that exposes the same tools:

```bash
# Claude Code adds via stdio
claude mcp add sql-preview -- sql-preview-server --stdio
```

When running in stdio mode, the server won't have HTTP for the UI resource delivery. Claude Code terminal can't render iframes anyway, so users fall back to:

1. Text-only results in the terminal
2. Open browser at `localhost:8414` for interactive view

## Client Support Matrix

| Client            | MCP Apps Support | Fallback              |
| ----------------- | ---------------- | --------------------- |
| Claude Web        | Yes              | -                     |
| Claude Desktop    | Yes              | -                     |
| VS Code Insiders  | Yes              | -                     |
| Goose             | Yes              | -                     |
| Postman           | Yes              | -                     |
| Claude Code (CLI) | No (terminal)    | Text + browser link   |
| Cursor            | Unknown          | Likely text + browser |

For unsupported clients, the tool still works - they just get text output instead of the interactive grid. The existing browser UI at `localhost:8414` serves as the fallback.

## Implementation Plan

### Phase 1: Basic MCP App

1. Set up Vite build for single-file HTML bundle
   - Install dev dependencies: `vite`, `vite-plugin-singlefile`, `@vitejs/plugin-react`
   - Install dependencies: `react`, `react-dom`, `ag-grid-react`, `ag-grid-community`, `@modelcontextprotocol/ext-apps`, `express`
2. Create minimal React app with AG Grid
3. Implement `App` class connection and `ontoolresult` handler
4. Create `McpAppsServer` in `src/server/` with Streamable HTTP transport
5. Register `run_query` tool with UI metadata
6. Register UI resource handler
7. Test with `basic-host` from ext-apps repo

### Phase 2: Full Feature Parity

1. Port all AG Grid features from VS Code webview:
   - Column resizing and persistence
   - Sorting and filtering
   - Cell selection and copy
   - Row height adjustment
2. Implement export CSV functionality
3. Implement re-run query via `callServerTool`
4. Add theme synchronization with host

### Phase 3: Integration

1. Add MCP Apps server to VS Code extension startup
2. Support both SSE (legacy) and Streamable HTTP endpoints
3. Create stdio wrapper for Claude Code users
4. Update configuration to support both modes

### Phase 4: Polish

1. Add `describe_table` tool with schema viewer UI
2. Add query history UI (if host supports state)
3. Handle large result sets (pagination)
4. Error state UI improvements
5. Loading states and animations

## Open Questions

1. **Bundle size**: AG Grid is ~90KB gzipped. Is this acceptable for inline rendering? Could use a lighter grid if needed.

2. **Multiple queries**: When user runs multiple queries, does each get its own iframe? Or should we implement tabs within one iframe?

3. **State persistence**: Can the UI persist across conversation turns? Or does it reset each time?

4. **Fullscreen mode**: Should we support `app.requestDisplayMode('fullscreen')` for complex data exploration?

5. **Streaming results**: For large queries, can we stream rows to the UI progressively using `ontoolinputpartial`?

## References

- [MCP Apps Documentation](https://modelcontextprotocol.io/docs/extensions/apps.md)
- [MCP Apps Specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx)
- [ext-apps GitHub Repository](https://github.com/modelcontextprotocol/ext-apps)
- [App Class API](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html)
- [Example: Cohort Heatmap Server](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/cohort-heatmap-server)
