# RFC-017: Daemon Configuration System

**Status:** Proposed  
**Created:** 2026-02-27  
**Owner:** Core Team  
**Related RFCs:** RFC-009 (Headless MCP Server), RFC-015 (Long-Lived Subprocesses)

## Goal

Replace scattered hardcoded constants with a unified, layered configuration system for the daemon process. Enable operators and developers to tune performance, security, and behavior without code changes.

## Problem Statement

The daemon currently has over a dozen behavioral parameters hardcoded across multiple files. Changing any of them requires editing source code, recompiling, and redeploying. This is unacceptable for a tool that runs in diverse environments (local dev machines, CI/CD, headless servers, containers).

### Inventory of Hardcoded Values

| File                           | Constant                 | Value       | Description                           |
| ------------------------------ | ------------------------ | ----------- | ------------------------------------- |
| `Daemon.ts:412`                | `IDLE_TIMEOUT_MS`        | 30 min      | Daemon auto-shutdown after inactivity |
| `Daemon.ts:413`                | `MCP_SESSION_TIMEOUT_MS` | 5 min       | Stale MCP session cleanup             |
| `Daemon.ts:468`                | Cleanup interval         | 60s         | How often idle checks run             |
| `SessionManager.ts:23`         | `MAX_SESSIONS`           | 50          | Maximum concurrent sessions           |
| `SessionManager.ts:24`         | `MAX_TABS_PER_SESSION`   | 20          | Maximum tabs per session              |
| `DaemonQueryExecutor.ts:173`   | `maxRows`                | 1000        | Maximum rows returned per query       |
| `Daemon.ts:58`                 | `HTTP_PORT`              | 8414        | HTTP/WS listen port                   |
| `Daemon.ts:534`                | Listen address           | `127.0.0.1` | Network bind address                  |
| `SocketTransport.ts`           | Buffer limit             | 10 MB       | Max message size on Unix socket       |
| `SubProcessConnectorClient.ts` | (none)                   | ∞           | No query timeout                      |

The `maxRows` case is particularly telling — the code itself contains `// TODO: Get from Daemon Config` on line 173 of `DaemonQueryExecutor.ts`.

### Environment Variables: Ad-Hoc and Incomplete

Some values are configurable via environment variables, but the approach is inconsistent:

| Variable                    | Used In           | Controls            |
| --------------------------- | ----------------- | ------------------- |
| `MCP_PORT`                  | `Daemon.ts`       | HTTP port           |
| `SQL_PREVIEW_HOME`          | `Daemon.ts`       | Config directory    |
| `SQL_PREVIEW_LOG_LEVEL`     | `ConsoleLogger`   | Log verbosity       |
| `SQL_PREVIEW_ENABLE_DUCKDB` | `DriverManager`   | Feature flag        |
| `SQL_PREVIEW_CONNECTIONS`   | `EnvProfileStore` | Connection profiles |

There is no unified config file, no config validation, no defaults documentation, and no way to see the active configuration at runtime.

## Scope

### In Scope

- Daemon configuration file format and schema
- Configuration loading with layered precedence (defaults → file → env → CLI)
- Runtime configuration API (read-only via `/status`, write for safe subset)
- Migration of all hardcoded constants to config
- Config validation and error reporting at startup
- Documentation of all configuration options

### Out of Scope

- VS Code extension settings (these are managed by VS Code's `configuration` contribution)
- Connection profiles (managed by `ConnectionManager` / RFC-010)
- Dynamic config reload without restart (future enhancement)
- Config encryption or secret management (handled by `ICredentialStore` / RFC-010)

## Proposal

### 1. Configuration File

A JSON file at `~/.sql-preview/daemon.json` (or `$SQL_PREVIEW_HOME/daemon.json`):

```jsonc
{
  "$schema": "https://sql-preview.dev/schemas/daemon-config.json",
  "version": 1,

  "server": {
    "port": 8414,
    "host": "127.0.0.1",
    "idleTimeoutMs": 1800000,
    "cors": {
      "enabled": false,
      "origins": ["http://localhost:*"],
    },
  },

  "sessions": {
    "maxSessions": 50,
    "maxTabsPerSession": 20,
    "sessionTimeoutMs": 300000,
    "cleanupIntervalMs": 60000,
  },

  "query": {
    "maxRows": 1000,
    "timeoutMs": 300000,
    "maxConcurrentQueries": 10,
  },

  "subprocess": {
    "pooling": true,
    "maxIdleMs": 300000,
    "maxProcesses": 10,
    "healthCheckIntervalMs": 30000,
  },

  "metadata": {
    "cacheTtlMs": 60000,
    "maxCacheEntries": 1000,
  },

  "logging": {
    "level": "INFO",
    "format": "text",
    "file": null,
  },

  "transport": {
    "socket": {
      "enabled": true,
      "maxMessageSizeBytes": 10485760,
    },
    "websocket": {
      "enabled": true,
    },
    "http": {
      "enabled": true,
    },
  },
}
```

### 2. Configuration Schema and Validation

Define the config schema in TypeScript with strong typing and defaults:

```typescript
// src/server/config/DaemonConfig.ts

interface ServerConfig {
  port: number; // default: 8414
  host: string; // default: '127.0.0.1'
  idleTimeoutMs: number; // default: 1_800_000 (30 min)
  cors: {
    enabled: boolean; // default: false
    origins: string[]; // default: []
  };
}

interface SessionsConfig {
  maxSessions: number; // default: 50
  maxTabsPerSession: number; // default: 20
  sessionTimeoutMs: number; // default: 300_000 (5 min)
  cleanupIntervalMs: number; // default: 60_000 (1 min)
}

interface QueryConfig {
  maxRows: number; // default: 1000
  timeoutMs: number; // default: 300_000 (5 min)
  maxConcurrentQueries: number; // default: 10
}

interface SubprocessConfig {
  pooling: boolean; // default: true
  maxIdleMs: number; // default: 300_000 (5 min)
  maxProcesses: number; // default: 10
  healthCheckIntervalMs: number; // default: 30_000
}

interface MetadataConfig {
  cacheTtlMs: number; // default: 60_000
  maxCacheEntries: number; // default: 1000
}

interface LoggingConfig {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'; // default: 'INFO'
  format: 'text' | 'json'; // default: 'text'
  file: string | null; // default: null (stdout/stderr)
}

interface TransportConfig {
  socket: { enabled: boolean; maxMessageSizeBytes: number };
  websocket: { enabled: boolean };
  http: { enabled: boolean };
}

interface DaemonConfig {
  version: number;
  server: ServerConfig;
  sessions: SessionsConfig;
  query: QueryConfig;
  subprocess: SubprocessConfig;
  metadata: MetadataConfig;
  logging: LoggingConfig;
  transport: TransportConfig;
}
```

### 3. Configuration Loading with Layered Precedence

Configuration is resolved in order of increasing priority:

```
Built-in Defaults  →  Config File  →  Environment Variables  →  CLI Flags
```

```typescript
// src/server/config/ConfigLoader.ts

class ConfigLoader {
  private config: DaemonConfig;

  constructor() {
    // 1. Start with built-in defaults
    this.config = structuredClone(DEFAULT_CONFIG);

    // 2. Merge config file (if exists)
    const configPath = path.join(this.configDir, 'daemon.json');
    if (fs.existsSync(configPath)) {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      this.validate(fileConfig);
      this.config = deepMerge(this.config, fileConfig);
    }

    // 3. Apply environment variable overrides
    this.applyEnvOverrides();

    // 4. Apply CLI flag overrides
    this.applyCliOverrides(process.argv);
  }

  get<K extends keyof DaemonConfig>(section: K): DaemonConfig[K];
  getAll(): Readonly<DaemonConfig>;
}
```

#### Environment Variable Mapping

Environment variables follow a `SQL_PREVIEW_` prefix with `__` as nesting separator:

| Environment Variable             | Config Path            | Example                |
| -------------------------------- | ---------------------- | ---------------------- |
| `SQL_PREVIEW_PORT`               | `server.port`          | `8414`                 |
| `SQL_PREVIEW_HOST`               | `server.host`          | `0.0.0.0`              |
| `SQL_PREVIEW_IDLE_TIMEOUT_MS`    | `server.idleTimeoutMs` | `3600000`              |
| `SQL_PREVIEW_MAX_ROWS`           | `query.maxRows`        | `5000`                 |
| `SQL_PREVIEW_MAX_SESSIONS`       | `sessions.maxSessions` | `100`                  |
| `SQL_PREVIEW_LOG_LEVEL`          | `logging.level`        | `DEBUG`                |
| `SQL_PREVIEW_LOG_FORMAT`         | `logging.format`       | `json`                 |
| `SQL_PREVIEW_SUBPROCESS_POOLING` | `subprocess.pooling`   | `false`                |
| `MCP_PORT`                       | `server.port`          | `8414` (legacy compat) |

Legacy environment variables (`MCP_PORT`, `SQL_PREVIEW_HOME`, `SQL_PREVIEW_LOG_LEVEL`) continue to work.

#### CLI Flag Mapping

A subset of critical options can be overridden via CLI flags:

```bash
sql-preview-server --port 9000 --host 0.0.0.0 --log-level DEBUG --max-rows 5000
```

### 4. Validation

Validate configuration at startup and fail fast with clear error messages:

```typescript
class ConfigValidator {
  validate(config: Partial<DaemonConfig>): ValidationResult {
    const errors: string[] = [];

    // Type checks
    if (config.server?.port !== undefined) {
      if (
        !Number.isInteger(config.server.port) ||
        config.server.port < 1 ||
        config.server.port > 65535
      ) {
        errors.push(
          `server.port must be an integer between 1 and 65535, got: ${config.server.port}`
        );
      }
    }

    // Range checks
    if (config.query?.maxRows !== undefined) {
      if (config.query.maxRows < 1 || config.query.maxRows > 1_000_000) {
        errors.push(`query.maxRows must be between 1 and 1,000,000, got: ${config.query.maxRows}`);
      }
    }

    // Logical consistency
    if (
      config.sessions?.sessionTimeoutMs !== undefined &&
      config.server?.idleTimeoutMs !== undefined
    ) {
      if (config.sessions.sessionTimeoutMs > config.server.idleTimeoutMs) {
        errors.push(
          `sessions.sessionTimeoutMs (${config.sessions.sessionTimeoutMs}) should not exceed server.idleTimeoutMs (${config.server.idleTimeoutMs})`
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
```

### 5. Runtime Configuration API

Extend the `/status` endpoint and add a `/config` endpoint:

```typescript
// GET /config — returns active configuration (sensitive values redacted)
this.app.get('/config', (_req, res) => {
  const config = this.configLoader.getAll();
  res.json({
    ...config,
    _source: {
      file: configFilePath,
      envOverrides: appliedEnvOverrides,
    },
  });
});
```

This is read-only. Runtime config changes require a daemon restart (hot-reload is out of scope).

### 6. Integration with Existing Code

The `ConfigLoader` is instantiated once in `Daemon.ts` constructor and injected as a dependency:

```typescript
// Daemon.ts constructor
class Daemon {
  private config: ConfigLoader;

  constructor() {
    this.config = new ConfigLoader();

    this.HTTP_PORT = this.config.get('server').port;
    // ...

    this.sessionManager = new SessionManager(
      ConsoleLogger.getInstance(),
      this.config.get('sessions') // passes config section
    );

    this.queryExecutor = new DaemonQueryExecutor(
      this.connectorRegistry,
      this.connectionManager,
      ConsoleLogger.getInstance(),
      this.driverManager,
      this.config.get('query') // passes config section
    );
  }
}
```

Each consumer receives only the config section it needs, following the principle of least privilege.

### 7. Generated Config on First Run

When the daemon starts and no `daemon.json` exists, it writes a commented template:

```typescript
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
  logger.info(`Created default config at ${configPath}`);
}
```

This gives users a starting point without documentation hunting.

## Alternatives Considered

| Alternative               | Rejection Reason                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **YAML config**           | JSON is already used everywhere in the project (package.json, connection profiles). Adding a YAML parser is an unnecessary dependency.         |
| **TOML config**           | Same rationale. JSON is sufficient and self-consistent with the ecosystem.                                                                     |
| **VS Code settings only** | The daemon runs independently (headless, standalone). VS Code settings are only available when the extension is active.                        |
| **Config via MCP tool**   | Adds complexity. Configuration should be set before the daemon starts processing requests. MCP tools are for runtime operations.               |
| **dotenv file**           | `.env` files don't support nesting, types, or validation. Fine for secrets (handled by RFC-010 credential stores), poor for structured config. |

## Implementation Plan

### Phase 1: Config Infrastructure

1. Create `src/server/config/DaemonConfig.ts` with types and `DEFAULT_CONFIG`
2. Create `src/server/config/ConfigLoader.ts` with file + env loading
3. Create `src/server/config/ConfigValidator.ts`
4. Unit tests for loader (merge logic, env overrides, validation)

### Phase 2: Daemon Integration

5. Instantiate `ConfigLoader` in `Daemon.ts` constructor
6. Replace `IDLE_TIMEOUT_MS`, `MCP_SESSION_TIMEOUT_MS`, `HTTP_PORT` with config reads
7. Pass `sessions` config to `SessionManager` — replace `MAX_SESSIONS`, `MAX_TABS_PER_SESSION`
8. Pass `query` config to `DaemonQueryExecutor` — replace hardcoded `maxRows: 1000`
9. Pass `transport` config to socket/WS setup
10. Add `/config` endpoint

### Phase 3: Logger Integration

11. Initialize `ConsoleLogger` from `logging` config (level, format)
12. Add JSON log format option for production/container environments
13. Add optional file logging

### Phase 4: CLI Flags

14. Parse CLI flags in `bin/server.ts` and `standalone.ts`
15. Pass CLI overrides to `ConfigLoader`
16. Update `--help` output with available flags

### Phase 5: Documentation & DX

17. Write config reference section in README
18. Generate JSON schema for IDE autocompletion in `daemon.json`
19. Add `sql-preview-server --dump-config` to print resolved config and exit

## Acceptance Criteria

1. **File config works**: Creating `~/.sql-preview/daemon.json` with `{"query": {"maxRows": 5000}}` causes the daemon to return up to 5000 rows
2. **Env override works**: Setting `SQL_PREVIEW_MAX_ROWS=2000` overrides file config
3. **Precedence is correct**: CLI > Env > File > Default. Verifiable via `/config` endpoint
4. **Validation catches errors**: `{"server": {"port": -1}}` causes startup failure with clear message
5. **Legacy compat**: Existing `MCP_PORT` and `SQL_PREVIEW_LOG_LEVEL` env vars continue to work
6. **First-run UX**: Fresh daemon creates `daemon.json` with defaults
7. **`/config` endpoint**: Returns full resolved config with source information
8. **No regressions**: All existing tests pass with no config file present (defaults match current hardcoded values)

## Risks and Mitigations

| Risk                                                             | Likelihood | Mitigation                                                                                                                 |
| ---------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Config file syntax errors crash daemon                           | High       | `try-catch` around parse; log error and fall back to defaults with warning                                                 |
| Breaking change if defaults differ from current hardcoded values | Medium     | Set defaults to exactly match current values. Add migration notes for intentional changes.                                 |
| Config file permissions too open (world-readable)                | Low        | Check file permissions on startup; warn if `daemon.json` is readable by others (contains no secrets, but defense in depth) |
| Config proliferation (too many knobs)                            | Medium     | Start minimal. Only expose values that users have asked to change or that differ across deployment modes.                  |

## Rollout and Backout

**Rollout**: Fully backward compatible. If no `daemon.json` exists, all defaults match current behavior exactly. No user action required.

**Backout**: Delete `daemon.json`. The daemon falls back to built-in defaults which are identical to the pre-RFC behavior.

## Open Questions

1. **Should we support `daemon.jsonc` (JSON with comments)?** Users often want to annotate their config. Could use `JSON5` or strip comments before parsing.
2. **Config reload signal?** Future enhancement: `SIGHUP` to reload config without full restart. Out of scope but worth designing the `ConfigLoader` to support it.
3. **Per-connection query limits?** Should `maxRows` be overridable per connection profile, or only at the daemon level? Both have valid use cases.
