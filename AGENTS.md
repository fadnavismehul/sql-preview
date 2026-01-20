# AGENTS.md

## Overview

This document serves as a guide for AI Agents contributing to the **SQL Preview** repository. It outlines the project structure, development workflows, and "ways of working" to ensure consistency and quality.

## Project Structure

```
sql-preview/
├── src/
│   ├── core/           # Core domain logic (Logging, Execution Engine)
│   ├── connectors/     # Data source integrations (Trino, Generic Interface)
│   ├── modules/        # Functional modules (MCP Server)
│   └── ...
├── webviews/           # Front-end assets (HTML/CSS/JS) for extension views
├── docs/
│   ├── implementations/ # RFCs and Roadmap items
│   └── guides/          # User and Developer guides
├── scripts/            # Utility and probe scripts
└── package.json        # Extension manifest and build scripts
```

## Ways of Working

### 1. Documentation First (RFCs)

- **New Features**: Before implementing significant new features, create an RFC (Request For Comments) markdown file in `docs/implementations/`.
  - Naming convention: `RFC-XXX-short-description.md`.
  - Outline the goal, design, and implementation plan.
- **Roadmap**: Future plans are tracked in `docs/implementations/RFC-000-roadmap.md`.

### 2. Code Organization

- **Modular Design**: Keep core logic decoupled from VS Code specific APIs where possible. Use `src/core` for domain logic.
- **Interfaces**: Use generic interfaces (e.g., `IConnector`) to allow for easy extensibility (new databases).
- **Styling**:
  - Use `webviews/results/theme.css` for centralized styling.
  - Respect VS Code theme variables (`var(--vscode-...)`) to ensure the extension looks native.

### 3. Quality Assurance

- **Testing**:
  - **Unit Tests**: Located in `src/test/unit/`. Run via `npm test`.
  - **Integration Tests**: Located in `src/test/suite/`. Run via `npm run test:integration`.
- **Linting**: Always run `npm run quality-check` before finishing a task.

### 4. Release Process

- Update `CHANGELOG.md`.
- Bump version in `package.json`.
- Verify build with `vsce package`.

## Tooling

- **Probes**: Use `npm run probe` (Trino connectivity) or `npm run probe:extension` (Extension path simulation) in `scripts/` to debug connectivity issues quickly.

## Context

- **MCP**: The extension exposes an MCP (Model Context Protocol) server. Logic resides in `src/modules/mcp`.
- **AG Grid**: The results view uses AG Grid Community. Styling is heavily customized in `theme.css`.

---

_Created by Antigravity Agent, 2026-01-20_
