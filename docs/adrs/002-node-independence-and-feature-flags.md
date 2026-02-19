# 2. Node.js Independence and Feature Flagging

Date: 2026-02-19

## Status

Accepted

## Context

The extension depends on a Node.js runtime to execute the Daemon process. Historically, we relied on the system's `node` executable being present in the user's `PATH`. This approach failed for users who did not have Node.js installed or had it in non-standard locations. Furthermore, the inclusion of native modules (specifically `@duckdb/node-api`) introduced ABI compatibility risks if the daemon was run with a Node.js version different from the one used during compilation (e.g., falling back to VS Code's internal Electron-based Node.js runtime).

## Decision

We have decided to:

1.  Implement a **robust daemon spawning strategy** that first attempts to use the system `node` executable but falls back to `process.execPath` (VS Code's bundled Node.js runtime) if the system `node` is missing. This ensures the daemon can run in environments without a separate Node.js installation.
2.  Introduce **feature flagging** for native modules, specifically the DuckDB connector. It is disabled by default and controlled by the `sqlPreview.experimental.duckDb` setting locally or the `SQL_PREVIEW_ENABLE_DUCKDB` environment variable globally. The native module is loaded dynamically only when this flag is active.
3.  Add explicit checks for `npm` availability in the `DriverManager` before attempting to install drivers, providing clear error messages instead of cryptic failures.

## Consequences

### Positive

- **Increased Reliability**: Users without Node.js can now use the extension's core features (like Trino connectivity) without issues.
- **Reduced Crash Risk**: Native module incompatibilities are avoided by default, as the risky module is not loaded unless explicitly enabled.
- **Better User Experience**: Clearer error messages guide users who need to install Node.js for advanced features (like driver installation).

### Negative

- **Opt-in Functionality**: DuckDB support, which was previously available by default (albeit risky), is now opt-in, potentially confusing some users.
- **Runtime Variation**: Running the daemon inside VS Code's Electron environment might expose differences in performance or standard library behavior compared to a standard Node.js runtime.
