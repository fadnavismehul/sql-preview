# Changelog

## [0.4.4] - 2026-01-27

### Added

- **MCP Feedback**: Added `SQL Preview: Test MCP Server Connection` command to verify server health.
- **MCP Status**: Updated Status Bar to show the specific port number the MCP server is bound to.

### Changed

- **MCP Reliability**: Implemented port rolling (auto-increment) for MCP server. If port 3000 is busy, it will try 3001, 3002, etc. This enables multiple VS Code windows to run the extension simultaneously without conflict.

## [0.4.3] - 2026-01-27

### Fixed

- **Connection Robustness**: Enhanced input sanitization for Trino connections. It now automatically strips protocols (`http://`, `https://`) and duplicative port numbers from the Host field, resolving common `ENOTFOUND` and connection timeout errors caused by copy-pasting full URLs.

## [0.4.2] - 2026-01-27

### Added

- **Filter Improvements**: Added a "Select All" checkbox to the column set filter, enabling easier bulk selection and deselection of visible items.

### Fixed

- **Data Parsing Integrity**: Fixed a critical issue where high-precision decimal numbers (e.g. `1932.53...`) were incorrectly parsed as "Invalid Number" or strings. The parser now intelligently handles BigInts while preserving standard floating point numbers for correct display and sorting.

## [0.3.9] - Unreleased

### Added

- **Open Source Preparation**:
  - Added MIT License and updated copyright year to 2026.
  - Added Security Policy (`SECURITY.md`) and Code of Conduct (`CODE_OF_CONDUCT.md`).
  - Created Contribution Guidelines (`CONTRIBUTING.md`) and Developer Guide (`ARCHITECTURE.md`).
  - Added GitHub Issue and Pull Request templates.
  - configured GitHub Actions for CI/CD (lint, test, build).
  - Added Dependabot configuration.
- **Testing & Quality**:
  - Added `test:coverage` script for test coverage reporting.
  - Improved unit test reliability (password management tests).
  - Adopted strict linting and formatting standards.
- **Codebase**:
  - Replaced console logs with structured `Logger` in MCP Server.
  - Cleaned up unused dependencies (`body-parser`, `glob`, etc.).

## [0.3.8] - 2026-01-20

### Added

- **UI UX Polish**:
  - Implemented "native-like" grid selection feel by removing browser text overlay.
  - Enhanced copy/paste functionality to reliably copy rows as TSV with headers.
  - Added persistence for "Row Height" preference (Normal, Compact, Comfortable).
  - Unified gutter selection styling for a consistent visual experience.

### Changed

- **Architecture**: Decoupled MCP Server from `ResultsViewProvider` for better modularity and stability.
- **MCP Server**: Improved robustness of server startup/shutdown to prevent `EADDRINUSE` and `ERR_SERVER_NOT_RUNNING` errors.

### Fixed

- **Runtime Stability**: Resolved race conditions in MCP server lifecycle.
- **Styling**: Fixed AG Grid focus ring issues and selection color inconsistencies.

## [0.2.4] - 2026-01-12

### Fixed

- **State Persistence**: Resolved persistent test failures and ensured `workspaceState` is correctly managed.
- **Results Provider**: Fixed memory leaks by cleaning up event listeners on disposal.
- **Linting**: Addressed numerous code style and type safety issues (removed console logs, fixed strict types).

## [0.2.2] - 2025-12-08

### Added

- **Tab Naming Configuration**: Added `sqlPreview.tabNaming` setting to switch between `file-sequential` (Result 1, Result 2) and `query-snippet` naming.
- **Settings Organization**: Organized settings into transparent groups: Connection, Display, and Advanced (Beta).

### Fixed

- **Tab Naming**: Fixed issue where tabs would revert to query snippet naming during loading.
- **Loading UX**: Improved loading experience by hiding the empty grid and random headers while the query executes.

## [0.2.1] - 2025-12-01

### Added

- **MCP Server**: Added Model Context Protocol (MCP) server feature for enhanced context awareness.

### Fixed

- **Persistence**: Fixed issues with state persistence.
- **Tab Management**: Fixed tab focus issues and added comprehensive tests for tab management.
- **Sync**: Fixed MCP synchronization issues.

## [0.2.0] - 2025-11-30

### Added

- **AG Grid Improvements**:
  - Added copy functionality for rows, columns, and cells.
  - Added query tooltips.
  - Added column datatypes display in headers.
- **Run in New Tab**: Added capability to execute queries in a new tab.
- **JSON Viewer**: Added a JSON viewer for better data inspection.

### Changed

- **AG Grid Standardization**:
  - Restored standard column menu.
  - Enhanced context menu.
  - Updated scrollbar styling.
- **Refactor**: Moved column type display to tooltips and fixed selection behavior.

### Fixed

- **Windows Compatibility**: Addressed further Windows-specific bugs.
- **Network**: Fixed HTTPS request handling.

## [0.1.6] - 2025-11-07

### Fixed

- Work around Porta returning "Empty query not supported" for valid SQL when using the Trino client. The extension now executes the first page via direct HTTPS POST to `/v1/statement` with Trino and Presto headers, then follows `nextUri` using HTTP GET. This mirrors clients like DataGrip and restores compatibility.
- Pagination: continue even when `columns` are not present in the first response (some clusters send columns on later pages).
- Export flow aligned to the same direct POST + pagination path for consistency.

### Added

- Probes to diagnose connectivity quickly:
  - `npm run probe` (multiple HTTP variants)
  - `npm run probe:extension` (matches extension path end-to-end)
- `.env.local` workflow (git-ignored) and `env.example` for credentials during local probes.

### Added

- Initial VS Code extension setup for Presto/Trino database connections
- **Secure password storage** using VS Code's SecretStorage API
- Password management commands for secure credential handling
- **Settings UI integration** for password management with "Set Password" button
- Command palette integration with `Presto: Run Query` command
- Code lens provider for executing SQL queries directly from editor
- Results view panel with Tabulator integration for data visualization
- Configuration setting for maximum rows to display (`presto.maxRowsToDisplay`)
- Pagination support for fetching large result sets
- Visual styling improvements for the results grid:
  - Integration with VS Code theme
  - Row number column
  - Improved formatting and density
  - Header styling enhancements
- Connection handling with authentication support
- Error handling and display in the results view
- Query execution status indicators
- Dynamic theme color integration with VS Code:
  - Table adapts to user's selected theme
  - Row backgrounds, text colors, and borders match theme
  - Support for light, dark, and high-contrast themes
  - Live theme updates when user changes VS Code theme

### Changed

- **SECURITY**: Removed plaintext password storage from settings - now uses secure VS Code SecretStorage
- Replaced Tabulator with AG Grid for the results view, providing enhanced features and a more modern grid experience.
- Enabled floating filters by default in the AG Grid results view for easier column-specific filtering.
- Updated results display to use Tabulator for better data visualization
- Improved results panel styling to better match VS Code themes
- Enhanced query result handling with pagination support
- Switched from `client.execute()` to `client.query()` for compatibility
- Refactored CSS to use theme variables for consistent styling

### Fixed

- **Windows Compatibility**: Fixed "path must not be empty" error during extension activation on Windows systems
  - Added comprehensive path validation and normalization for cross-platform compatibility
  - Enhanced webview resource path handling with graceful fallback mechanisms
  - Implemented proper error handling and logging for path-related issues
  - Added validation for extension URI and resource roots to prevent empty path errors
  - Improved extension activation robustness with detailed error reporting
  - Properly mocked filesystem dependencies in tests instead of bypassing validation
- Resolved pagination issues when fetching large result sets
- Fixed layout and styling issues in the results view
- Corrected variable declarations (let vs const) based on usage patterns
- Addressed linter errors and warnings
- Fixed module resolution for the Results View Provider
- Resolved connection and authentication issues with Trino client

### Developer Improvements

- Added ESLint configuration
- Configured TypeScript compilation settings
- Added proper module structure and organization
- Implemented better error handling and logging
- Created theme-aware UI components for improved user experience
