# RFC-003: Single Server Architecture with Session Routing

**Status**: Proposed
**Created**: 2026-01-28
**Updated**: 2026-01-28

## Goal

Run a **single SQL Preview server process** that handles requests from multiple windows/clients, with automatic session routing so results appear in the correct context.

## Problem Statement

### Current Behavior

When multiple VS Code/Cursor windows are open, each spawns its own MCP server:

```
Window 1 → MCP Server on port 3000
Window 2 → MCP Server on port 3001
Window 3 → MCP Server on port 3002
```

This creates several problems:

1. **Port sprawl**: Users see different ports in different contexts, which is confusing
2. **Resource waste**: Multiple Node.js processes doing the same thing
3. **Configuration drift**: Each server reads settings independently
4. **No shared state**: Can't see results from Window 1 while in Window 2's UI

### Desired Behavior

```
Window 1 ─┐
Window 2 ─┼──► Single Server (port 8414) ──► Single Web UI
Window 3 ─┘
              └── Routes by session ID
```

One server, one port, one UI - but smart enough to know which window each request came from.

## Why Not Custom Protocol Handlers?

I initially considered using a custom URL scheme (`sql-preview://`) to hide the `localhost:port` complexity. After analysis, this approach has too many drawbacks:

**macOS requires an app bundle**: You can't just register a Node.js script as a protocol handler. You need a signed `.app` bundle with `Info.plist`, which means building and notarizing a real macOS app. This is significant overhead for what should be a simple tool.

**Browser security warnings**: Every time the protocol is triggered, browsers show "This site wants to open an application" dialogs. Users have to click "Allow" repeatedly, which feels janky.

**Security attack surface**: Any website could trigger `sql-preview://malicious-payload`. We'd need to validate and sanitize everything, adding complexity.

**Cross-platform maintenance burden**: macOS uses Info.plist, Windows uses registry keys, Linux uses .desktop files + xdg-mime. Three completely different implementations.

**Jupyter, Vite, webpack, pgAdmin, and every other dev tool just uses localhost:port**. Developers are comfortable with this. Fighting against the grain isn't worth the marginal UX improvement.

**Conclusion**: We'll use `http://localhost:8414` and make it consistent. The port 8414 was chosen because it visually resembles "DATA" - easy to remember and slightly more meaningful than an arbitrary number.

## Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────┐
│  User's Machine                                             │
│                                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                       │
│  │ VS Code │ │ Cursor  │ │ Claude  │                       │
│  │         │ │         │ │  Code   │                       │
│  └────┬────┘ └────┬────┘ └────┬────┘                       │
│       │           │           │                             │
│       │ session:  │ session:  │ session:                    │
│       │ "vsc-abc" │ "cur-def" │ "cli-ghi"                   │
│       │           │           │                             │
│       └───────────┴───────────┘                             │
│                   │                                         │
│                   ▼                                         │
│       ┌───────────────────────────────────────┐             │
│       │  sql-preview-server (daemon)          │             │
│       │                                       │             │
│       │  Unix Socket: ~/.sql-preview/srv.sock │             │
│       │  HTTP:        localhost:8414          │             │
│       │  WebSocket:   localhost:8414/ws       │             │
│       │                                       │             │
│       │  ┌─────────────────────────────────┐  │             │
│       │  │ Session Manager                 │  │             │
│       │  │ - vsc-abc: VS Code (my-project) │  │             │
│       │  │ - cur-def: Cursor (analytics)   │  │             │
│       │  │ - cli-ghi: Claude Code          │  │             │
│       │  └─────────────────────────────────┘  │             │
│       └───────────────────────────────────────┘             │
│                   │                                         │
│                   ▼                                         │
│       ┌───────────────────────────────────────┐             │
│       │  Browser: http://localhost:8414       │             │
│       │                                       │             │
│       │  [Session: VS Code - my-project ▼]    │             │
│       │  ┌─────────────────────────────────┐  │             │
│       │  │ AG Grid Results                 │  │             │
│       │  └─────────────────────────────────┘  │             │
│       └───────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

### Why a Daemon?

The server runs as a **user-level daemon** rather than being spawned per-window. This is the right model because:

1. **Shared state**: All windows see the same results store, enabling cross-window workflows
2. **Single port**: Always 8414, no port hunting or conflicts
3. **Survives window closes**: Results persist even if you close VS Code
4. **Lower resource usage**: One Node.js process instead of many

The daemon starts on first use and stays running until explicitly stopped or the user logs out.

### Why Unix Sockets for IPC?

For communication between VS Code/Claude Code and the server, we use Unix sockets (`~/.sql-preview/srv.sock`) instead of HTTP:

1. **No port allocation**: Unix sockets are filesystem paths, not network ports
2. **Faster**: No TCP overhead, direct kernel-level IPC
3. **More secure**: Socket file permissions (0600) restrict access to the owning user
4. **No network exposure**: Impossible to accidentally expose to the network

On Windows, we'll use named pipes (`\\.\pipe\sql-preview`) which provide similar benefits.

HTTP on port 8414 is reserved for the browser-based UI, which genuinely needs HTTP.

### Session Management

Each client registers a session when it connects:

```typescript
interface Session {
  id: string; // Unique ID, e.g., "vsc-a1b2c3"
  displayName: string; // Human-readable, e.g., "VS Code - my-project"
  clientType: 'vscode' | 'cursor' | 'claude-code' | 'standalone';
  workspaceRoot?: string; // For context, e.g., "/Users/me/my-project"
  connectedAt: Date;
  lastActivityAt: Date;
}
```

**Why sessions matter**: When you run a query from VS Code Window 1, the results should appear in a tab associated with that window. Without sessions, all results would be dumped into one shared pool, which would be confusing when working on multiple projects.

**Session ID generation**: We prefix with the client type for easy identification:

- VS Code: `vsc-{uuid}`
- Cursor: `cur-{uuid}`
- Claude Code CLI: `cli-{uuid}`
- Web UI direct: `web-{uuid}`

**Session naming**: The display name is auto-generated from context:

1. Use workspace folder name if available
2. Fall back to git repo name
3. Fall back to "Untitled Session"

### MCP Tool Changes

MCP tools now include session context:

```typescript
// run_query tool
interface RunQueryParams {
  sql: string;
  connection?: string;
  session: string; // ← Required: identifies the calling window
  newTab?: boolean;
}

// Response includes session for routing
interface RunQueryResult {
  tabId: string;
  sessionId: string; // ← Results tagged with session
  rowCount: number;
  // ... columns, rows, etc.
}
```

The session ID flows through the entire pipeline:

1. Client sends query with session ID
2. Server executes query
3. Results stored with session tag
4. WebSocket pushes to browser with session filter
5. Browser UI shows results for selected session

### Web UI Session Handling

The browser UI at `http://localhost:8414` shows a session picker:

```
┌─────────────────────────────────────────────────────────────┐
│  SQL Preview                                                │
├─────────────────────────────────────────────────────────────┤
│  Session: [VS Code - my-project        ▼]                   │
│           ├─ VS Code - my-project (3 tabs)                  │
│           ├─ Cursor - analytics (1 tab)                     │
│           ├─ Claude Code (2 tabs)                           │
│           └─ All Sessions (6 tabs)                          │
├─────────────────────────────────────────────────────────────┤
│  [Query 1] [Query 2] [Query 3]                    [+ New]   │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │                                                       │  │
│  │                  AG Grid Results                      │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**URL routing**:

- `http://localhost:8414` → Shows last active session
- `http://localhost:8414?session=vsc-abc` → Shows specific session
- `http://localhost:8414?session=all` → Shows all tabs from all sessions

When a query completes, the MCP response can include a deep link:

```
Query completed. 142 rows returned.
View results: http://localhost:8414?session=cli-xyz&tab=abc123
```

### Server Lifecycle

**Startup sequence**:

```typescript
async function ensureServerRunning(): Promise<Socket> {
  const socketPath = path.join(os.homedir(), '.sql-preview', 'srv.sock');
  const pidPath = path.join(os.homedir(), '.sql-preview', 'server.pid');

  // 1. Check if server is already running
  if (await isSocketResponsive(socketPath)) {
    return connect(socketPath);
  }

  // 2. Clean up stale socket/pid if server crashed
  await cleanupStaleFiles(socketPath, pidPath);

  // 3. Spawn server as detached background process
  const serverBin = await resolveServerBinary();
  const child = spawn(serverBin, ['--daemon'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, SQL_PREVIEW_DAEMON: '1' },
  });
  child.unref();

  // 4. Wait for server to be ready (polls socket)
  await waitForSocket(socketPath, { timeout: 5000 });

  return connect(socketPath);
}
```

**Why check socket responsiveness, not just existence?**: A socket file might exist from a crashed server. We send a ping message and wait for a pong to confirm the server is actually alive.

**Shutdown**: The server shuts down after 30 minutes of inactivity (no connected clients, no recent queries). This prevents orphan processes while keeping the server warm for typical usage patterns.

**Manual control**:

```bash
sql-preview-server start    # Start daemon (if not running)
sql-preview-server stop     # Stop daemon gracefully
sql-preview-server status   # Show running status, port, sessions
sql-preview-server logs     # Tail server logs
```

### File Locations

```
~/.sql-preview/
├── srv.sock              # Unix socket for IPC
├── server.pid            # PID file for daemon management
├── server.log            # Server logs (rotated, max 10MB)
├── config.json           # User configuration (connections, settings)
└── sessions/             # Persisted session data (optional)
    ├── vsc-abc.json
    └── cli-xyz.json
```

**Why `~/.sql-preview/` instead of XDG directories?**: Simplicity. XDG compliance means different paths for config vs. runtime vs. cache, across different OSes. A single dotfolder is easier to understand, backup, and delete.

## Configuration

Without VS Code settings, we need a standalone configuration approach:

```json
// ~/.sql-preview/config.json
{
  "connections": {
    "default": {
      "type": "trino",
      "host": "trino.company.com",
      "port": 443,
      "user": "analyst",
      "catalog": "hive",
      "schema": "default",
      "ssl": true
    },
    "local-postgres": {
      "type": "postgres",
      "host": "localhost",
      "port": 5432,
      "user": "postgres",
      "database": "myapp"
    },
    "analytics-db": {
      "type": "sqlite",
      "path": "/path/to/analytics.db"
    }
  },
  "defaultConnection": "default",
  "server": {
    "port": 8414,
    "idleTimeoutMinutes": 30
  },
  "ui": {
    "maxRows": 10000,
    "theme": "system"
  },
  "safeMode": true
}
```

**Environment variable overrides** (useful for CI/containers):

```bash
SQL_PREVIEW_HOST=trino.company.com
SQL_PREVIEW_USER=analyst
SQL_PREVIEW_PASSWORD=secret        # Never stored in config file
SQL_PREVIEW_PORT=8414
```

**Password handling**: Passwords are never stored in `config.json`. Options:

1. Environment variable (`SQL_PREVIEW_PASSWORD`)
2. System keychain via `keytar` library (prompts once, stores securely)
3. Prompt on first query (stores in memory only)

We'll use approach #2 (keychain) as default, with #1 as override for automation scenarios.

## Security Considerations

**Unix socket permissions**: The socket file is created with mode `0600` (owner read/write only). Other users on the system cannot connect.

**No network binding**: The HTTP server binds to `127.0.0.1:8414`, never `0.0.0.0`. The server is only accessible from the local machine.

**Session isolation**: Database credentials are stored per-connection, not per-session. All sessions with access to the server can use any configured connection. This is intentional - the server is single-user.

**Safe mode**: By default, only SELECT/SHOW/DESCRIBE/EXPLAIN/WITH queries are allowed through MCP. This prevents accidental data modification when an AI agent is running queries. Can be disabled in config for trusted scenarios.

## Implementation Plan

### Phase 1: Daemon Infrastructure

1. Create daemon process management (start, stop, health check)
2. Implement Unix socket server alongside existing HTTP server
3. Add PID file and lock management
4. Handle graceful shutdown on SIGTERM/SIGINT
5. Add idle timeout auto-shutdown

### Phase 2: Session Management

1. Define session registration protocol over Unix socket
2. Implement in-memory session store
3. Modify QueryExecutor to tag results with session ID
4. Add session filtering to TabManager
5. Update MCP tools to require session parameter

### Phase 3: Client Updates

1. Update VS Code extension to connect to daemon instead of spawning server
2. Add session registration on extension activation
3. Update MCP server wrapper to relay through daemon
4. Handle daemon not running (auto-start)

### Phase 4: Web UI Updates

1. Add session picker component
2. Implement session-filtered tab list
3. Add URL parameter support for session deep links
4. Add "All Sessions" view option
5. Show session indicator in status bar

### Phase 5: Standalone Package

1. Extract daemon into `@sql-preview/server` npm package
2. Create CLI with start/stop/status commands
3. Add configuration file support
4. Write setup documentation for Claude Code users

## Migration Path

**For existing VS Code extension users**: The extension will detect if the new daemon is available. If so, it connects to the daemon. If not, it falls back to the current per-window server behavior. This allows gradual rollout.

**For new standalone users**:

```bash
npm install -g @sql-preview/server
sql-preview-server start
claude mcp add sql-preview -- sql-preview-client
```

The `sql-preview-client` command connects to the running daemon and bridges stdio MCP to the Unix socket.

## Open Questions

1. **Session persistence**: Should session data (tabs, results) persist across server restarts?
   - Leaning toward: Yes, with configurable TTL (default 24 hours)

2. **Multi-user machines**: Should we support system-wide server for shared machines?
   - Leaning toward: No, keep it simple with per-user daemon

3. **Remote server mode**: Should the daemon be exposable over network for team sharing?
   - Leaning toward: Out of scope for this RFC, but architecture shouldn't preclude it
