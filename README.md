# SQL Preview for VS Code

A Visual Studio Code extension for connecting to **Trino** databases, running SQL queries, and visualizing results directly within your editor.

## Features

- **SQL Query Execution**: Run SQL queries against Trino databases directly from VS Code.
- **Interactive Results View**: View query results in a high-performance AG Grid table with sorting, filtering, and resizing.
- **Code Lens Integration**: Execute queries with a single click from your `.sql` files.
- **Client-Server Architecture**: Uses a dedicated background daemon for reliable connection management and query execution.
- **Secure Password Storage**: Passwords are encrypted using the OS keyring via VS Code's SecretStorage API.
- **MCP Integration (Beta)**: Exposes database tools to AI agents via the Model Context Protocol.

## Usage

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

## Configuration

Add the following configuration to your `settings.json`:

```json
{
  "sqlPreview.defaultConnector": "trino",
  "sqlPreview.host": "trino-coordinator.example.com",
  "sqlPreview.port": 443,
  "sqlPreview.user": "your-username",
  "sqlPreview.catalog": "hive",
  "sqlPreview.schema": "default",
  "sqlPreview.ssl": true,
  "sqlPreview.sslVerify": true,
  "sqlPreview.maxRowsToDisplay": 1000,
  "sqlPreview.logLevel": "INFO" // Options: DEBUG, INFO, WARN, ERROR
}
```

### Secure Password Management

For security, passwords are never stored in plain text.

1.  **Set Password**: Run the command `SQL Preview: Set Database Password` or click "Set Password" in the Settings UI.
2.  **Clear Password**: Run `SQL Preview: Clear Stored Password`.

## 🤖 Model Context Protocol (MCP) Integration (Beta)

This extension includes a built-in MCP server that allows AI assistants (like Claude) to interact with your database.

### Enabling MCP

1.  Open VS Code Settings.
2.  Set `sqlPreview.mcpEnabled` to `true`.
3.  (Optional) Set `sqlPreview.mcpSafeMode` to `true` (default) to restrict AI to read-only queries.
4.  Restart the extension or run `SQL Preview: Restart Background Server`.

### Available Tools

When enabled, the following tools are available to MCP clients:

- `run_query`: Execute a SQL query.
- `list_tables`: List tables in a schema.
- `describe_table`: Show table schema.
- `get_ddl`: Get the CREATE TABLE statement.

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
