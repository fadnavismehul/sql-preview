# sql-preview-mysql

MySQL / MariaDB connector for [SQL Preview](https://github.com/sql-preview).

## Installation

```bash
npm install sql-preview-mysql mysql2
```

## Connection Profile

```json
{
  "id": "my-mysql",
  "name": "Production MySQL",
  "type": "mysql",
  "host": "db.example.com",
  "port": 3306,
  "user": "analyst",
  "password": "...",
  "database": "analytics",
  "ssl": false,
  "timezone": "UTC",
  "connectTimeout": 10000
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `host` | ✅ | — | MySQL server hostname or IP |
| `port` | ✅ | 3306 | TCP port |
| `user` | ✅ | — | MySQL username |
| `database` | ✅ | — | Target database name |
| `password` | — | — | Stored via ICredentialStore |
| `ssl` | — | `false` | Enable TLS/SSL |
| `sslVerify` | — | `true` | Verify server certificate (set `false` for self-signed) |
| `timezone` | — | `'local'` | e.g. `'UTC'`, `'+05:30'` |
| `connectTimeout` | — | `10000` | Connection timeout in ms |

## Claude Desktop Setup

```json
{
  "mcpServers": {
    "sql-preview": {
      "command": "npx",
      "args": ["-y", "@sql-preview/server", "--stdio"],
      "env": {
        "SQL_PREVIEW_CONNECTIONS": "[{\"id\":\"prod\",\"name\":\"Prod MySQL\",\"type\":\"mysql\",\"host\":\"db.example.com\",\"port\":3306,\"user\":\"analyst\",\"password\":\"YOUR_PASSWORD\",\"database\":\"analytics\"}]"
      }
    }
  }
}
```

## CLI Usage

```bash
# One-shot query
sql-preview-mysql \
  --query "SELECT COUNT(*) AS total FROM orders" \
  --config "$(echo '{"host":"localhost","port":3306,"user":"root","password":"secret","database":"mydb"}' | base64)"

# MCP stdio server
sql-preview-mysql --mcp
```

## Compatibility

| Driver | Versions |
|--------|---------|
| MySQL  | 5.7, 8.0, 8.4 |
| MariaDB | 10.4, 10.6, 10.11, 11.x |
| Azure Database for MySQL | Flexible Server |
| PlanetScale | Compatible (disable `ssl` for local proxy) |

## Schema Metadata

This connector implements `listSchemas`, `listTables`, and `describeTable` via MySQL's `information_schema`. Claude and other agents use these methods to discover your database structure before generating queries.

## Known Limitations

- Results are fully buffered (no streaming). Very large result sets will consume memory proportional to the result size.
- `rowsAsArray: true` is used for performance; column names come from the field descriptors, not the row keys.
- BigInt columns are returned as JavaScript `number`; values exceeding `Number.MAX_SAFE_INTEGER` may lose precision.
