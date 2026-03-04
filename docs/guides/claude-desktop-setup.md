# Claude Desktop & MCP Integration Setup

SQL Preview can run as a standalone Model Context Protocol (MCP) server, allowing AI agents like **Claude Desktop**, **Cursor**, and **Claude Code** to securely execute queries, read tables, and describe schemas directly from your databases.

## 1. Prerequisites

You must map your database configurations via an environment variable called `SQL_PREVIEW_CONNECTIONS`. This ensures the MCP server can connect headlessly without relying on VS Code settings.

The format is a JSON array of connection objects:

```bash
export SQL_PREVIEW_CONNECTIONS='[
  {
    "id": "prod-postgres",
    "name": "Production User DB",
    "type": "postgres",
    "host": "db.example.com",
    "port": 5432,
    "user": "analyst",
    "database": "analytics",
    "password": "YOUR_PASSWORD_HERE"
  }
]'
```

> **Security Note:** While convenient for local development, passing plaintext passwords in JSON arrays is not strictly secure. For production environments, we recommend relying on driver-specific environment variables for passwords (e.g., `PGPASSWORD` for PostgreSQL) if supported, or storing the config file securely.

## 2. Setting up Claude Desktop

Claude Desktop natively supports standard output (stdio) MCP servers. Add the `@sql-preview/server` to your Claude Desktop configuration file.

1. Open your Claude Desktop configuration:
   - **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
2. Add the `mcpServers` block:

```json
{
  "mcpServers": {
    "sql-preview": {
      "command": "npx",
      "args": ["-y", "@sql-preview/server", "--stdio"],
      "env": {
        "SQL_PREVIEW_CONNECTIONS": "[{\"id\":\"local-duck\",\"type\":\"duckdb\",\"path\":\"./mydb.duckdb\"}]"
      }
    }
  }
}
```

3. Restart Claude Desktop.

## 3. Setting up Cursor

Cursor supports MCP to enhance its codebase understanding with live database access.

1. Open Cursor Settings > **Features** > **MCP Servers**.
2. Click **+ Add new MCP server**.
3. Set the type to `command`.
4. Enter the name (e.g., `sql-preview`).
5. Enter the command: `npx -y @sql-preview/server --stdio`.
6. Ensure your Cursor IDE context has the `SQL_PREVIEW_CONNECTIONS` environment variable set, or embed it directly into the command using `env SQL_PREVIEW_CONNECTIONS="..." npx...` if supported by your OS.

## 4. Setting up Claude Code (CLI)

To attach the SQL Preview server to a Claude Code CLI session:

```bash
# Set your connections in your terminal profile
export SQL_PREVIEW_CONNECTIONS='[{"id":"local-pg","type":"postgres","host":"localhost","port":5432,"user":"postgres"}]'

# Add the MCP server
claude mcp add sql-preview -- npx -y @sql-preview/server --stdio
```

## Available Tools

Once connected, your AI assistant will have access to the following tools:

- `run_query`: Execute arbitrary SQL.
- `list_tables`: Enumerate tables within a database/schema.
- `describe_table`: Look up column definitions and data types.
- `get_ddl`: Reconstruct the CREATE TABLE statements for a table.
