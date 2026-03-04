# SQL Preview for VS Code & Claude Desktop

A powerful tool for connecting to **PostgreSQL, Trino, MySQL, BigQuery, Snowflake, DuckDB**, and more.

Use it as a **VS Code extension** to run SQL queries and visualize results interactively, or use it as a standalone **Model Context Protocol (MCP) server** to let Claude Desktop and Cursor securely query your databases.

## Features

- **Multi-Database Support**: Connects to major SQL dialects via pluggable connector packages.
- **VS Code Integration**: Run SQL queries directly from your `.sql` files with a single click and view results in a high-performance AG Grid table.
- **AI Agent Native**: Includes a built-in MCP server that exposes database tools (`run_query`, `list_tables`, `describe_table`) to AI assistants.
- **Client-Server Architecture**: Uses a dedicated background daemon for reliable connection management and crash isolation.
- **Out-of-Process Connectors**: Database drivers run in separate processes, preventing heavy queries from crashing your editor.
- **Secure Password Storage**: Passwords are encrypted using the OS keyring via VS Code's SecretStorage API.

## Usage (VS Code)

### Running Queries

1.  Open a `.sql` file.
2.  **Code Lens**: Click "Run Query" above the SQL block.
3.  **Command Palette**: Open the palette (`Cmd+Shift+P`) and run `SQL Preview: Run Query`.
4.  **Shortcut**: Press `Cmd+Enter` (Mac) or `Ctrl+Enter` (Windows/Linux) to run the query.

### Viewing Results

Results appear in the **SQL Preview** panel.

- **Sort**: Click column headers.
- **Filter**: Use the text boxes below headers.
- **Export**: Right-click to copy cells.

## Architecture

This extension uses a robust **Client-Server** model:

1.  **Extension (Client)**: The VS Code frontend that handles UI, commands, and configuration.
2.  **Daemon (Server)**: A separate Node.js process that manages database connections and executes queries.
3.  **Communication**: The Client and Daemon communicate via the **Model Context Protocol (MCP)** over local sockets.

This separation ensures that long-running queries do not block the VS Code UI and provides a stable environment for database interactions.

## Configuration (VS Code)

To configure default connections in VS Code, add profiles to your settings. Note that different connectors take different parameters:

```json
{
  "sqlPreview.defaultConnector": "postgres",
  "sqlPreview.host": "db.example.com",
  "sqlPreview.port": 5432,
  "sqlPreview.user": "analyst",
  "sqlPreview.database": "analytics",
  "sqlPreview.ssl": true,
  "sqlPreview.maxRowsToDisplay": 1000
}
```

### Secure Password Management

For security, passwords are never stored in plain text in your `settings.json`.

1.  **Set Password**: Run the command `SQL Preview: Set Database Password` or click "Set Password" in the Settings UI.
2.  **Clear Password**: Run `SQL Preview: Clear Stored Password`.

## 🤖 Model Context Protocol (MCP) Integration

SQL Preview isn't just a VS Code extension; it is also distributed as a standalone MCP server via NPM (`@sql-preview/server`). This allows AI assistants to interact safely with your databases.

### 1. Claude Desktop, Cursor, & CLI Setup

To use SQL Preview outside of VS Code (e.g., in Claude Desktop), you can run the standalone daemon in `stdio` mode.

Please read our full [Claude Desktop Setup Guide](docs/guides/claude-desktop-setup.md) for copy-paste instructions covering Configuration Profiles and Claude/Cursor wiring.

### 2. VS Code Assistant Integration (Beta)

To enable tools for AI instances running _within_ your VS Code environment (like Claude or GitHub Copilot):

1.  Open VS Code Settings.
2.  Set `sqlPreview.mcpEnabled` to `true`.
3.  (Optional) Set `sqlPreview.mcpSafeMode` to `true` (default) to restrict AI to read-only `SELECT` queries.
4.  Restart the extension or run `SQL Preview: Restart Background Server`.

### Available Tools

When connected via MCP, your AI assistant gains these tools:

- `run_query`: Execute arbitrary SQL.
- `list_tables`: Enumerate tables within a schema.
- `describe_table`: Show table schema and column types.
- `get_ddl`: Retrieve the CREATE TABLE statement.

## Project Structure

```
sql-preview/
├── src/
│   ├── extension.ts          # Main extension entry point (Client)
│   ├── server/               # Daemon process (Server)
│   │   ├── Daemon.ts         # Server entry point
│   │   └── DaemonMcpServer.ts # MCP implementation
│   ├── connectors/           # Database connectors (Trino)
│   └── ui/                   # Webview logic
└── webviews/                 # Frontend assets (React/HTML/CSS)
```

## Development

1.  **Clone**: `git clone ...`
2.  **Install**: `npm install`
3.  **Build**: `npm run build`
4.  **Debug**: Press `F5` to start the Extension Host.

## MCP Debugging

- `MCP_PORT=8552 npx @modelcontextprotocol/inspector node out/server/standalone.js --stdio`
