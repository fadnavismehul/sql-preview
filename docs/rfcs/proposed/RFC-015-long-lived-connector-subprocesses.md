# RFC-015: Long-Lived Connector Subprocesses

**Status:** Proposed  
**Created:** 2026-02-27  
**Owner:** Core Team  
**Related RFCs:** RFC-012 (Pluggable Connectors), RFC-013 (Agentic MCP Connectors)

## Goal

Eliminate per-query process spawn overhead for pluggable connectors by keeping connector subprocesses alive across multiple queries, enabling connection pooling, warm caches, and substantially lower query latency.

## Problem Statement

RFC-013 introduced out-of-process connectors via `SubProcessConnectorClient`. Each query currently:

1. Spawns a new child process (`child_process.spawn`)
2. Passes config as base64 CLI args
3. The child process creates a brand-new database connection
4. Executes the query
5. Writes results as newline-delimited JSON to stdout
6. The child process exits

This works correctly but has critical performance issues:

### Measured Costs

| Step                                       | Typical Latency |
| ------------------------------------------ | --------------- |
| Process spawn (`fork` + Node.js bootstrap) | 100-300ms       |
| Database connection handshake (Postgres)   | 50-200ms        |
| Query execution (simple SELECT)            | 5-50ms          |
| Process teardown                           | ~50ms           |

For a simple `SELECT 1`, the overhead is **4-10x** the actual query time. For interactive workflows where users run queries frequently, this degrades the experience significantly.

### Additional Limitations

1. **No connection pooling**: Postgres `pg.Client` creates/closes a TCP connection per query. Connection pool benefits (prepared statement caching, reduced handshake overhead) are lost entirely.
2. **No warm caches**: DuckDB and SQLite lose in-memory caches between queries. DuckDB's catalog cache, buffer pool, and JIT-compiled expressions are rebuilt from scratch each time.
3. **Resource waste**: Each spawn loads the full connector module, initializes the driver, and parses config — all redundant work for repeated queries against the same database.
4. **No graceful cancellation**: `SIGINT` kills the process but doesn't allow the connector to send a cancellation request to the database server (e.g., Postgres `pg_cancel_backend`).

### Current Code Path

```typescript
// DaemonQueryExecutor.ts:58-61
this.logger.info(
  `Spawning out-of-process connector client for [${connectorId}] at ${executablePath}`
);
return new SubProcessConnectorClient(connectorId, executablePath);
// ^ Creates a NEW SubProcessConnectorClient per query, which spawns a NEW process
```

```typescript
// SubProcessConnectorClient.ts:40
const child = spawn(process.execPath, [this.executablePath, ...args], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
// ^ Spawns a fresh Node.js process for EVERY runQuery() call
```

## Scope

### In Scope

- Long-lived subprocess lifecycle management (spawn, health check, restart, shutdown)
- Subprocess communication protocol (JSON-RPC over stdio)
- Connection pooling within subprocesses
- Subprocess pool keyed by connector type + connection profile
- Graceful query cancellation via protocol messages
- Idle subprocess cleanup

### Out of Scope

- Changing the `IConnector` interface (backward compatible)
- MCP-based connector communication (future RFC-014 covers WebSocket/Arrow)
- Remote connector processes (network-hosted connectors)
- Subprocess sandboxing / security (covered by RFC-005 session security)

## Proposal

### Architecture: Subprocess Pool

Replace the current "spawn-per-query" model with a **Subprocess Pool** managed by the Daemon.

```
┌─────────────────────────────────────────────────────┐
│                     Daemon                          │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │          ConnectorProcessPool                │   │
│  │                                              │   │
│  │  Key: connectorType + profileHash            │   │
│  │                                              │   │
│  │  ┌────────────────┐  ┌────────────────┐      │   │
│  │  │ postgres:abc123│  │ duckdb:memory  │      │   │
│  │  │                │  │                │      │   │
│  │  │ SubProcess     │  │ SubProcess     │      │   │
│  │  │ (pid: 12345)   │  │ (pid: 12346)   │      │   │
│  │  │ idle: 30s      │  │ active: 2 qry  │      │   │
│  │  │ health: ok     │  │ health: ok     │      │   │
│  │  └────────────────┘  └────────────────┘      │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  DaemonQueryExecutor                                │
│    → pool.getOrSpawn(profile) → LongLivedClient     │
│    → client.runQuery(query, config, signal)          │
└─────────────────────────────────────────────────────┘
```

### 1. ConnectorProcessPool

A new class that manages long-lived connector subprocesses.

```typescript
interface PoolEntry {
  client: LongLivedConnectorClient;
  profileHash: string;
  connectorType: string;
  spawnedAt: Date;
  lastUsedAt: Date;
  activeQueries: number;
  health: 'healthy' | 'unhealthy' | 'starting';
}

class ConnectorProcessPool {
  private pool = new Map<string, PoolEntry>();
  private readonly maxIdleMs: number; // configurable, default 5 min
  private readonly maxProcesses: number; // configurable, default 10
  private readonly healthCheckIntervalMs: number; // default 30s

  getOrSpawn(profile: ConnectionProfile, executablePath: string): Promise<LongLivedConnectorClient>;
  release(key: string): void;
  shutdown(): Promise<void>;
}
```

**Pool key**: `${connectorType}:${sha256(JSON.stringify(profileWithoutPassword))}` — ensures different connection targets get different subprocesses, but queries to the same target reuse the process.

### 2. LongLivedConnectorClient

Replaces `SubProcessConnectorClient` for pooled connectors. Implements `IConnector` but communicates with a persistent child process over JSON-RPC on stdio.

```typescript
class LongLivedConnectorClient implements IConnector {
  private child: ChildProcess;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;

  readonly id: string;
  readonly supportsPagination = true;

  constructor(connectorId: string, executablePath: string);

  async spawn(config: ConnectorConfig): Promise<void>;
  async *runQuery(
    query: string,
    config: ConnectorConfig,
    auth?: string,
    signal?: AbortSignal
  ): AsyncGenerator<QueryPage>;
  async testConnection(
    config: ConnectorConfig,
    auth?: string
  ): Promise<{ success: boolean; error?: string }>;
  async shutdown(): Promise<void>;
  isAlive(): boolean;
}
```

### 3. Stdio JSON-RPC Protocol

The child process runs in **daemon mode** (new flag: `--daemon`) and listens for JSON-RPC messages on stdin, responding on stdout.

#### Request Messages (Daemon → Connector)

```jsonc
// Initialize connection pool
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"config": {...}, "auth": "..."}}

// Execute query
{"jsonrpc": "2.0", "id": 2, "method": "runQuery", "params": {"query": "SELECT ...", "requestId": "q-123"}}

// Cancel query
{"jsonrpc": "2.0", "id": 3, "method": "cancelQuery", "params": {"requestId": "q-123"}}

// Health check
{"jsonrpc": "2.0", "id": 4, "method": "ping"}

// Graceful shutdown
{"jsonrpc": "2.0", "id": 5, "method": "shutdown"}
```

#### Response Messages (Connector → Daemon)

```jsonc
// Initialize success
{"jsonrpc": "2.0", "id": 1, "result": {"status": "ready", "capabilities": {"pagination": true}}}

// Query page (streamed — one per page)
{"jsonrpc": "2.0", "method": "queryPage", "params": {"requestId": "q-123", "page": {"columns": [...], "data": [...]}}}

// Query complete
{"jsonrpc": "2.0", "id": 2, "result": {"requestId": "q-123", "status": "complete"}}

// Query error
{"jsonrpc": "2.0", "id": 2, "error": {"code": -32000, "message": "relation \"foo\" does not exist"}}

// Ping response
{"jsonrpc": "2.0", "id": 4, "result": {"status": "healthy", "activeConnections": 3}}
```

### 4. Connector-Side Changes

Each pluggable connector's CLI entry point (`cli.ts`) gains a `--daemon` mode:

```typescript
// packages/sql-preview-postgres/src/cli.ts
if (args.includes('--daemon')) {
  const connector = new PostgresConnector();
  const pool = new pg.Pool(configFromInitialize); // connection pooling!
  const server = new ConnectorDaemonServer(connector, pool, process.stdin, process.stdout);
  server.start();
} else if (args.includes('--mcp')) {
  // Existing MCP server mode
} else {
  // Existing one-shot CLI mode
}
```

**Key benefit**: In daemon mode, Postgres uses `pg.Pool` instead of per-query `pg.Client`. DuckDB keeps its in-memory instance alive. SQLite holds the database handle open.

### 5. Integration with DaemonQueryExecutor

```typescript
// DaemonQueryExecutor.ts - updated getConnectorForProfile
private async getConnectorForProfile(profile: ConnectionProfile): Promise<IConnector> {
  // In-process connector (Trino) — unchanged
  const inProcess = this.connectorRegistry.get(profile.type);
  if (inProcess) return inProcess;

  // Out-of-process: use pool instead of spawning fresh
  const executablePath = await this.driverManager.getConnectorExecutablePath(profile.type);
  return this.processPool.getOrSpawn(profile, executablePath);
}
```

### 6. Lifecycle & Health

| Event                     | Behavior                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------- |
| First query for a profile | `ConnectorProcessPool.getOrSpawn()` spawns child, sends `initialize`, waits for `ready` |
| Subsequent queries        | Reuses existing child process, multiplexes via `requestId`                              |
| Idle timeout (5 min)      | Pool sends `shutdown`, child closes connections and exits gracefully                    |
| Child process crash       | Pool detects via `close` event, marks entry as `unhealthy`, next query triggers respawn |
| Health check failure      | Pool sends `ping`, no response in 5s → mark unhealthy, kill, respawn on next use        |
| Daemon shutdown           | Pool sends `shutdown` to all children, waits up to 3s, then SIGKILL remaining           |
| Config change             | Profile hash changes → new pool entry, old one idles out                                |

## Alternatives Considered

| Alternative                                          | Rejection Reason                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **In-process connectors for all**                    | Crashes (DuckDB segfault) bring down the entire daemon. Native modules complicate packaging. This was the motivation for RFC-013. |
| **gRPC between daemon and connectors**               | Requires proto compilation, adds significant dependency. JSON-RPC over stdio is simpler and already proven in MCP ecosystem.      |
| **WebSocket pool**                                   | More complex than stdio for local IPC. RFC-014 already covers WebSocket for external/remote scenarios.                            |
| **Pre-fork pool (multiple processes per connector)** | Overkill for a dev tool. Single process per profile is sufficient; connectors handle concurrency internally via connection pools. |

## Implementation Plan

### Phase 1: Core Pool Infrastructure

1. Create `ConnectorProcessPool` class in `src/server/`
2. Create `LongLivedConnectorClient` implementing `IConnector`
3. Define JSON-RPC protocol types in `packages/sql-preview-connector-api/`
4. Wire pool into `DaemonQueryExecutor` constructor

### Phase 2: Connector Daemon Mode

5. Add `ConnectorDaemonServer` base class to `packages/sql-preview-connector-api/`
6. Update `sql-preview-postgres` with `--daemon` mode and `pg.Pool`
7. Update `sql-preview-duckdb` with `--daemon` mode and persistent instance
8. Update `sql-preview-sqlite` with `--daemon` mode and held database handle

### Phase 3: Lifecycle & Resilience

9. Implement health check loop in `ConnectorProcessPool`
10. Implement idle cleanup timer
11. Implement crash-and-respawn logic
12. Add pool metrics to `/status` endpoint

### Phase 4: Backward Compatibility

13. Keep `SubProcessConnectorClient` as fallback for connectors that don't support `--daemon`
14. Feature detection: if child responds to `initialize`, use long-lived mode; otherwise fall back to one-shot

## Acceptance Criteria

1. **Latency**: Second query to the same Postgres connection completes in <100ms overhead (vs ~300ms+ currently)
2. **Connection reuse**: `pg.Pool` statistics show connections being reused across queries (visible in health check response)
3. **Crash recovery**: Killing a connector subprocess (`kill -9 <pid>`) and running another query succeeds within 1 second (auto-respawn)
4. **Idle cleanup**: Subprocess exits after configured idle timeout; `/status` endpoint shows pool size dropping
5. **Backward compat**: Connectors without `--daemon` support still work via `SubProcessConnectorClient`
6. **Cancellation**: `cancelQuery` message causes Postgres to call `pg_cancel_backend` and return partial results

## Risks and Mitigations

| Risk                                                 | Likelihood | Mitigation                                                                   |
| ---------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| Subprocess memory leak over time                     | Medium     | Health checks monitor memory via `/proc`; auto-restart if exceeds threshold  |
| Stdio buffer deadlock (both sides waiting for read)  | Low        | Non-blocking readline; separate request/response correlation via `id`        |
| Pool key collision (different profiles hashing same) | Very Low   | Include all meaningful config fields in hash; add profile `id` as tiebreaker |
| Connector doesn't support daemon mode                | Expected   | Fallback to `SubProcessConnectorClient` is automatic                         |

## Rollout and Backout

**Rollout**: Behind a daemon config flag `subprocess.pooling: true` (default: `true`). Can be disabled to fall back to per-query spawning.

**Backout**: Set `subprocess.pooling: false` in daemon config. The `SubProcessConnectorClient` codepath is preserved unchanged.

## Open Questions

1. **Concurrent query limit per subprocess?** Postgres `pg.Pool` has `max` connections (default 10). Should we expose this in daemon config?
2. **Should the pool key include credentials?** Currently excluded for security (no password in hash). But changing password for same host requires pool eviction — acceptable?
3. **Process affinity for file-based connectors?** SQLite/DuckDB file queries create adhoc profiles. Should these share a subprocess or always get a fresh one?
