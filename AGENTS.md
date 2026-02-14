# AGENTS.md

> **"A Map, Not a Manual"**
> This file is the high-level map of the SQL Preview repository. It serves as the entry point for AI agents to understand the project structure, architectural patterns, and where to find more detailed information.

## 🗺️ Repository Overview

**SQL Preview** is a VS Code extension for connecting to Presto/Trino databases, executing queries, and visualizing results.

### Key Locations

- **[src/extension.ts](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/extension.ts)**: The main entry point for the VS Code extension.
- **[src/server/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/server/)**: The backend Daemon process (MCP Server) that handles database connections and query execution.
- **[src/connectors/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/connectors/)**: Implementations of database drivers (e.g., Trino, Hive).
- **[src/webviews/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/webviews/)**: Frontend code for the results view (React/Vanilla JS).
- **[package.json](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/package.json)**: Definition of extension commands, configuration, and dependencies.

### Documentation Index

- **[README.md](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/README.md)**: User-facing documentation, features, and setup.
- **[CONTRIBUTING.md](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/CONTRIBUTING.md)**: Developer guide for setup, building, and submitting changes.
- **[docs/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/docs/)**: Additional documentation and implementation guides.

## 🏗️ Architecture Patterns

### Client-Server Model

The extension operates on a client-server architecture:

1.  **Extension Host (Client)**: Runs in the VS Code process. Handles UI, commands, and configuration.
2.  **Daemon (Server)**: A separate Node.js process spawned by the extension. It manages heavy lifting like maintaining DB connections and fetching results.
3.  **Communication**: The Client and Daemon communicate via **MCP (Model Context Protocol)** over stdio or HTTP.

### UI Architecture

- **Webviews**: The results grid is rendered in a webview using `AG Grid` for high-performance data display.
- **Message Passing**: The extension interacts with webviews via `postMessage`.

## 🛠️ Development Tools

| Task       | Command           | Description                                   |
| :--------- | :---------------- | :-------------------------------------------- |
| **Build**  | `npm run compile` | Compiles TypeScript to JavaScript.            |
| **Lint**   | `npm run lint`    | Runs ESLint to check for code quality issues. |
| **Test**   | `npm test`        | Runs the unit test suite.                     |
| **Format** | `npm run format`  | formats code using Prettier.                  |

## 🧪 Verification & Quality

Before submitting changes:

1.  Run `npm run lint` to ensure no style violations.
2.  Run `npm test` to verify no regressions.
3.  Ensure any new features have corresponding tests in `src/test/`.

---

_For more details, follow the links provided above. If a path is missing or incorrect, update this map._
