# Setting up SQL Preview MCP Server with Claude Desktop

This guide explains how to configure the SQL Preview MCP Server to work with Claude Desktop, allowing Claude to run SQL queries against your databases directly.

## Prerequisites

- [Claude Desktop](https://claude.ai/download) installed
- Node.js (v18 or higher) installed
- Access to a Trino/Presto, Postgres, or SQLite database

## Installation

### Option 1: Using `npx` (Recommended)

You can run the server directly using `npx` without installing it globally. This fetches the latest version from npm.

### Option 2: Local Installation (For Development)

If you are developing the extension locally:

1.  Build the project: `npm run build`
2.  Link the package: `npm link`

## Configuration

### 1. Configure Database Credentials

The standalone server needs to know how to connect to your database. Create a configuration file at `~/.sql-preview/config.json`:

```json
{
  "connections": [
    {
      "id": "prod-trino",
      "name": "Production Trino",
      "type": "trino",
      "host": "your-trino-host.com",
      "port": 443,
      "user": "your-username",
      "password": "your-password",
      "ssl": true,
      "sslVerify": true,
      "catalog": "hive",
      "schema": "default"
    }
  ]
}
```

_Note: Replace the values with your actual database credentials._

### 2. Configure Claude Desktop

Open your Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the `sql-preview` server to the `mcpServers` section.

#### Using `npx` (Published Package)

```json
{
  "mcpServers": {
    "sql-preview": {
      "command": "npx",
      "args": ["-y", "sql-preview-server", "--stdio"]
    }
  }
}
```

#### Using Local Build (Development)

```json
{
  "mcpServers": {
    "sql-preview": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/project-preview/out/server/standalone.js", "--stdio"]
    }
  }
}
```

_Note: Replace `/ABSOLUTE/PATH/TO/project-preview` with the actual path to your local repository._

## Usage

Restart Claude Desktop. You can now prompt Claude to interact with your data:

- "List my database connections"
- "Run `SELECT * FROM users LIMIT 5` on the prod-trino connection"
- "Show me the schemas in the hive catalog"

### Providing Credentials Ad-Hoc

Navigate safely! You can also provide credentials directly in the chat if you don't want to save them in a config file:

> "Use this connection: host=trino.example.com, user=bob, password=secret. Run query: SELECT 1"

Claude will construct the connection profile dynamically for that session.
