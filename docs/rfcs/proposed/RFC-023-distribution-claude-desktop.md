# RFC-023: NPM Distribution and Claude Desktop Setup

**Status:** Proposed  
**Created:** 2026-03-02  
**Owner:** Core Team  
**Related RFCs:** RFC-009 (Headless MCP Server), RFC-012 (Pluggable Connectors), RFC-016 (Schema Metadata API), RFC-018 (MCP UI Refinement)

## Goal

Make SQL Preview trivially installable in Claude Desktop and other MCP clients via `npx @sql-preview/server --stdio`, with documented, copy-paste setup instructions. This is the distribution layer that turns internal infrastructure into a publicly usable product.

## Problem Statement

All the underlying pieces exist:

- The Daemon runs as a standalone server (`src/server/standalone.ts`)
- The MCP server exposes tools over SSE and stdio
- The VS Code `.vsix` is already 1.5 MB and published

But **a user cannot actually use SQL Preview with Claude Desktop today** because:

1. There is no `@sql-preview/server` NPM package — `npx @sql-preview/server` fails
2. The README says "Trino only" in the configuration section
3. No Claude Desktop JSON snippet exists anywhere in the documentation
4. Connection profile setup for headless mode (environment variables) is not documented
5. The MCP App bundle (`dist/mcp-app.html`) is built but its serving via the Streamable HTTP endpoint is not wired into the standalone server

## Scope

**In Scope:**

- Publish `@sql-preview/server` to NPM with a working `bin` entry
- `--stdio` flag: runs the daemon in stdio MCP mode (no HTTP server)
- `--port` / `--host` flags: runs as an HTTP server (SSE + Streamable HTTP)
- Claude Desktop setup documentation (copy-paste JSON snippet)
- Claude Code (CLI) setup documentation
- Cursor setup documentation
- Cross-platform test: macOS, Linux, Windows (WSL)
- README rewrite covering all supported connectors and all connection methods
- `SQL_PREVIEW_CONNECTIONS` environment variable documentation

**Out of Scope:**

- Auto-update mechanism for the NPM package
- Homebrew formula or system package manager integration (future)
- Docker image (future)
- Windows native installer (future)

## Proposal

### 1. NPM Package: `@sql-preview/server`

The package is the same codebase as the VS Code extension server but published separately to NPM. It wraps `src/server/standalone.ts`.

**`package.json` additions:**

```json
{
  "name": "@sql-preview/server",
  "version": "0.5.12",
  "description": "Standalone SQL Preview MCP server for Claude Desktop, Cursor, and other MCP clients",
  "main": "out/server/standalone.js",
  "bin": {
    "sql-preview-server": "./out/server/standalone.js"
  },
  "engines": { "node": ">=18.0.0" },
  "keywords": [
    "sql",
    "mcp",
    "claude",
    "database",
    "ai",
    "trino",
    "postgres",
    "mysql",
    "snowflake",
    "bigquery"
  ]
}
```

The existing `esbuild` standalone build target (`npm run build:standalone`) produces `out/server/standalone.js`. Publishing means this file must:

- Have `#!/usr/bin/env node` at the top (already done via esbuild `banner`)
- Be marked as executable (`chmod +x`)
- Bundle all dependencies except the connector packages (which are loaded dynamically)

**NPM publish CI step** (add to `.github/workflows/publish.yml`):

```yaml
- name: Publish @sql-preview/server
  run: npm publish --access public
  working-directory: .
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 2. stdio Mode

Claude Desktop requires a stdio-mode MCP server. The `--stdio` flag must:

- Suppress all daemon HTTP server startup
- Serve MCP over stdin/stdout using the MCP SDK's `StdioServerTransport`
- Read connection profiles from `~/.sql-preview/config.json` and `SQL_PREVIEW_CONNECTIONS` env var
- Not attempt to bind any port

```typescript
// src/server/standalone.ts
const isStdio = process.argv.includes('--stdio');

if (isStdio) {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
} else {
  daemon.start(); // existing HTTP/SSE startup
}
```

### 3. Claude Desktop Configuration Snippet

Add this to the README and to a dedicated `docs/guides/claude-desktop-setup.md`:

```json
{
  "mcpServers": {
    "sql-preview": {
      "command": "npx",
      "args": ["-y", "@sql-preview/server", "--stdio"],
      "env": {
        "SQL_PREVIEW_CONNECTIONS": "[{\"id\":\"prod\",\"name\":\"Production DB\",\"type\":\"postgres\",\"host\":\"db.example.com\",\"port\":5432,\"user\":\"analyst\",\"database\":\"analytics\",\"password\":\"YOUR_PASSWORD_HERE\"}]"
      }
    }
  }
}
```

Document the `SQL_PREVIEW_CONNECTIONS` format for each supported connector type.

> **Security note**: Embedding passwords in the Claude Desktop config is convenient but stores them in plaintext. Recommend using a `CommandCredentialStore` (future RFC-010 extension) or environment variables managed by a secrets manager.

### 4. Claude Code (CLI) Setup

```bash
claude mcp add sql-preview -- npx -y @sql-preview/server --stdio
```

Then set connections:

```bash
export SQL_PREVIEW_CONNECTIONS='[{"id":"default","type":"postgres","host":"localhost","port":5432,"user":"me","database":"mydb"}]'
```

### 5. Cursor Setup

Cursor supports MCP via `~/.cursor/mcp.json` (same format as Claude Desktop):

```json
{
  "mcpServers": {
    "sql-preview": {
      "command": "npx",
      "args": ["-y", "@sql-preview/server", "--stdio"]
    }
  }
}
```

### 6. README Rewrite

The README requires a full overwrite. Current problems:

| Current (broken)                    | Required                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| "connecting to **Trino** databases" | "connecting to **Trino, Postgres, MySQL, SQL Server, Snowflake, BigQuery**, and more" |
| Trino-only settings.json block      | Connector-specific config blocks or link to connector docs                            |
| "MCP Integration (Beta)"            | "MCP Integration"                                                                     |
| No Claude Desktop setup             | Full Claude Desktop, Claude Code, Cursor setup sections                               |
| No connector list                   | Connector compatibility table with links                                              |

### 7. MCP App Bundle in Standalone Server

The Streamable HTTP endpoint must serve `dist/mcp-app.html` when `ui://sql-preview/results-grid` is requested. This is currently not wired in the standalone server path (only in the VS Code extension path).

Wire it in `src/server/McpAppsServer.ts`:

```typescript
registerAppResource(this.server, resourceUri, resourceUri, { ... }, async () => {
  const htmlPath = path.join(__dirname, '../../dist/mcp-app.html');
  const html = await fs.readFile(htmlPath, 'utf-8');
  return { contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
});
```

The `dist/mcp-app.html` file must be included in the NPM package (`"files"` field in `package.json`) and in the `esbuild` standalone build output.

## Implementation Plan

1. **stdio transport**: Add `--stdio` branch to `src/server/standalone.ts`
2. **package.json**: Add `bin`, `"files"`, `keywords`, `engines`, correct `"name": "@sql-preview/server"`
3. **MCP App wiring**: Ensure `McpAppsServer` reads `dist/mcp-app.html` relative to `__dirname` correctly in the bundled standalone output
4. **Claude Desktop docs**: Write `docs/guides/claude-desktop-setup.md` with step-by-step instructions and the JSON snippet for each connector type
5. **README rewrite**: Update intro, Features list, Configuration section, MCP section
6. **CI publish**: Add `.github/workflows/publish.yml` npm publish step
7. **Cross-platform test**: Run `npx @sql-preview/server --stdio` on macOS, Ubuntu, Windows WSL

## Acceptance Criteria

1. `npx -y @sql-preview/server --stdio` starts without error on macOS, Linux, and Windows (WSL)
2. Pasting the Claude Desktop JSON snippet and restarting Claude Desktop results in `sql-preview` appearing in Claude Desktop's MCP server list
3. Asking Claude Desktop "What tools do you have?" confirms `run_query`, `list_connections`, `list_schemas`, `list_tables`, `describe_table` are available
4. Running `set_sql_preview_connections` environment variable with a Postgres profile and asking Claude "show me all tables" returns a correct result
5. `npm info @sql-preview/server` returns the package on the public NPM registry
6. README no longer mentions Trino-only; connector table is present; all MCP client setup sections are shown

## Risks and Mitigations

| Risk                                                                 | Likelihood | Mitigation                                                                                  |
| -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `dist/mcp-app.html` not included in NPM publish                      | Medium     | Add explicit `"files": ["out/", "dist/mcp-app.html"]` to `package.json`                     |
| `npx` caches old version and users get stale build                   | Low        | Document `npx --prefer-online @sql-preview/server --stdio` for troubleshooting              |
| stdio mode conflicts with daemon's internal logging (logs to stdout) | High       | All daemon logging must go to **stderr** in stdio mode; stdout is reserved for MCP protocol |
| Password in Claude Desktop config is insecure                        | Medium     | Document and recommend env-var approach; add warning in setup guide                         |

## Rollout and Backout

**Rollout:** Publish `@sql-preview/server@0.5.12` to NPM. Existing VS Code extension users are unaffected — the NPM package is additive.

**Backout:** `npm deprecate @sql-preview/server@0.5.12 "Use version X instead"`. The VS Code extension continues to work independently.

## Open Questions

1. Should we publish connector packages (`sql-preview-postgres`, `sql-preview-mysql`, etc.) to NPM as well, or keep them as internal packages auto-installed by the DriverManager? Decision: publish them — allows users to `npm install sql-preview-mysql` manually in CI/CD environments without relying on dynamic install.
2. Should the NPM package be `@sql-preview/server` (scoped) or `sql-preview-server` (unscoped)? Decision: `@sql-preview/server` — consistent with the connector package naming convention and signals the official provenance.
