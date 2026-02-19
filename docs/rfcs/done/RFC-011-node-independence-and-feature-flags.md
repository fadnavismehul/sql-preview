# RFC-011: Node.js Independence and Feature Flagging for Native modules

**Status:** Implemented
**Created:** 2026-02-19
**Owner:** Core Team

## Context

The extension previously relied on the system's `node` executable being present in the user's `PATH` to spawn the Daemon process. This caused issues for users who did not have Node.js installed or had it installed in non-standard locations. Additionally, the inclusion of native modules (specifically `@duckdb/node-api`) posed a risk of ABI incompatibility if the daemon was run with a Node.js version different from the one used during compilation (e.g., when falling back to VS Code's internal Node.js runtime).

## Decision

We have implemented a two-pronged approach to address these issues:

1.  **Robust Daemon Spawning with Fallback**: The extension now attempts to locate a system `node` executable first. If it cannot be found, it falls back to using `process.execPath` (the executable running the extension host, typically VS Code's Electron instance) with `ELECTRON_RUN_AS_NODE=1`. This ensures that the daemon can always run, even without a system-wide Node.js installation.

2.  **Feature Flagging for Native Modules**: To mitigate the risk of ABI incompatibility and potential crashes, the DuckDB connector (which relies on native bindings) is now feature-flagged. It is disabled by default and can be enabled via the `sqlPreview.experimental.duckDb` setting locally or `SQL_PREVIEW_ENABLE_DUCKDB` environment variable globally. The connector module is dynamically loaded only when this flag is active.

## Technical Details

### Daemon Spawning (`DaemonClient.ts`)

The `spawnDaemon` method in `DaemonClient` now performs the following logic:

1.  Constructs a robust `PATH` including common locations like `/usr/local/bin`, `/opt/homebrew/bin`, etc.
2.  Attempts to verify the existence of `node` by running `node --version`.
3.  If successful, spawns the daemon using `node`.
4.  If unsuccessful (e.g., `ENOENT`), logs a warning and falls back to spawning with `process.execPath` and sets `ELECTRON_RUN_AS_NODE=1` in the environment.

### DuckDB Feature Flag (`Daemon.ts`)

The `Daemon` class now checks for the `SQL_PREVIEW_ENABLE_DUCKDB` environment variable during initialization:

```typescript
if (process.env['SQL_PREVIEW_ENABLE_DUCKDB'] === 'true') {
  try {
    const { DuckDbConnector } = require('../connectors/duckdb/DuckDbConnector');
    this.connectorRegistry.register(new DuckDbConnector());
  } catch (e) {
    logger.error('Failed to load DuckDB connector:', e);
  }
}
```

This prevents the native module from being loaded (and potentially crashing the process) unless explicitly requested.

### Driver Installation (`DriverManager.ts`)

The `DriverManager` now explicitly checks for `npm` availability before attempting to install drivers. If `npm` is missing, it throws a user-friendly error instructing the user to install Node.js/npm, rather than failing with a cryptic spawn error.

## Verification

This implementation has been verified by:

1.  **Automated Unit Tests**: Ensuring fallback logic and environment variable handling work as expected.
2.  **Integration Tests**: Verifying that DuckDB queries work when the feature flag is enabled.
3.  **Manual Verification**: Simulating a missing Node.js environment and confirming that the extension falls back correctly and basic Trino functionality remains intact.

## Consequences

- **Positive**: Improved reliability for users without Node.js. Reduced crash risk from native module incompatibilities.
- **Negative**: DuckDB support is now opt-in, which may confuse users expecting it to work out of the box. Users falling back to VS Code's runtime might experience different performance characteristics or version constraints compared to a standard Node.js installation.
