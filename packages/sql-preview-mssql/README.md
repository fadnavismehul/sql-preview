# sql-preview-mssql

Microsoft SQL Server and Azure SQL Database connector for [SQL Preview](https://github.com/fadnavismehul/sql-preview).

## Features

- Full T-SQL query execution via the `mssql` driver (uses Tedious — pure JS, no native bindings)
- Azure SQL Database support with automatic `encrypt: true` detection
- Schema metadata: `listSchemas`, `listTables`, `describeTable` via `INFORMATION_SCHEMA`
- Friendly error classification: `AuthenticationError`, `ConnectionError`, `QueryError`
- MCP server mode for AI agent integration (Claude Desktop, Cursor, etc.)
- CLI mode for shell/scripting usage

## Connection Profile

```json
{
  "type": "mssql",
  "host": "localhost",
  "port": 1433,
  "user": "sa",
  "password": "YourPassword",
  "database": "mydb",
  "ssl": false,
  "trustServerCertificate": true
}
```

### Key Options

| Option | Default | Notes |
|--------|---------|-------|
| `port` | `1433` | Standard SQL Server port |
| `ssl` | `true` for Azure SQL, `false` otherwise | Maps to `encrypt` in mssql |
| `trustServerCertificate` | `false` | **Set `true` for local/dev instances** with self-signed certs |
| `instance` | — | Named instance (e.g. `SQLEXPRESS`) |
| `connectionTimeout` | `15000` ms | Time to establish connection |
| `requestTimeout` | `30000` ms | Time to wait for query result |
| `domain` | — | Windows domain for NTLM auth (optional) |

> **⚠️ SSL / TLS Note:** The most common connection error is a self-signed certificate rejection.
> For local SQL Server instances (Docker, development), add `"trustServerCertificate": true` to your profile.
> For Azure SQL Database, `ssl` is automatically set to `true` and the cert is trusted by default.

## Azure SQL Database

No special configuration needed: if `host` ends with `.database.windows.net`, `encrypt: true` is set automatically. Use SQL authentication (user/password).

```json
{
  "type": "mssql",
  "host": "myserver.database.windows.net",
  "user": "sqladmin",
  "password": "YourPassword",
  "database": "mydb"
}
```

## Running via MCP (Claude Desktop / Cursor)

```bash
# Install dependencies
npm install

# Run as MCP server (stdio transport)
node dist/cli.js --mcp
```

## CLI Usage

```bash
sql-preview-mssql --query "SELECT TOP 5 * FROM sys.tables" \
  --config $(echo '{"host":"localhost","user":"sa","password":"P@ssw0rd","database":"master","trustServerCertificate":true}' | base64)
```

## Development

```bash
npm install
npm test          # unit tests (mocked)
npm run test:integration  # requires Docker + Colima
npm run build
```

### Integration Tests

Integration tests spin up a SQL Server 2022 container via Testcontainers:

```bash
# Ensure Docker/Colima is running
colima start

# Run integration tests
DOCKER_HOST=unix://$HOME/.colima/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
npm run test:integration
```
