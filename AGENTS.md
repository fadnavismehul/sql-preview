# AGENTS.md

> **"A Map, Not a Manual"**
> This file is the high-level map of the SQL Preview repository. It serves as the entry point for AI agents to understand the project structure, architectural patterns, and where to find more detailed information.

## 🗺️ Repository Overview

**SQL Preview** is a VS Code extension for connecting to Presto/Trino databases, executing queries, and visualizing results.

### Core Modules

- **[Server & Daemon](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/server/AGENTS.md)**: The backend process handling database connections and MCP server.
- **[UI & Webviews](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/ui/AGENTS.md)**: The frontend visualization layer (React + AG Grid).
- **[Connectors](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/connectors/AGENTS.md)**: Database driver implementations (Trino, Postgres, SQLite).

### Key Locations

- **[src/extension.ts](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/extension.ts)**: The main entry point for the VS Code extension.
- **[package.json](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/package.json)**: Definition of extension commands, configuration, and dependencies.

### Documentation Index

- **[README.md](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/README.md)**: User-facing documentation, features, and setup.
- **[CONTRIBUTING.md](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/CONTRIBUTING.md)**: Developer guide for setup, building, and submitting changes.
- **[docs/rfcs/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/docs/rfcs/README.md)**: Request for Comments (Architectural Decisions).

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

1.  Check the **[Changelog](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/Changelog.md)** entry requirement.
2.  Run `npm run lint` to ensure no style violations.
3.  Run `npm test` to verify no regressions.

---

_For more details, follow the links provided above. If a path is missing or incorrect, update this map._
