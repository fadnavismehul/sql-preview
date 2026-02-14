# RFC-006: SQLite Support Strategy

**Feature Name:** SQLite Support
**Status:** Proposed
**Created:** 2026-02-13

## Summary

Re-introduce SQLite support to the SQL Preview extension without significantly increasing the package size for users who only need Trino/Presto support.

## Motivation

SQLite support was removed in v0.5.9 to resolve packaging issues and reduce the VSIX size (from ~13MB to ~1.5MB). The `sqlite3` dependency requires native bindings, which complicates packaging and increases download size. However, SQLite is a popular database for local development and testing, and supporting it is valuable.

## Proposed Solution

We propose a strategy to support SQLite as an optional or separate component.

### Option 1: Separate Extension (Recommended)

Create a separate extension `mehul.sql-preview-sqlite` that depends on the main extension or works as a standalone driver.

- **Pros:** Keeps the core extension light. Users only install what they need.
- **Cons:** Two extensions to maintain.

### Option 2: Dynamic Loading / Optional Dependency

Attempt to load `sqlite3` dynamically. If not found, prompt the user to install it (if possible in VS Code context) or download a pre-compiled binary.

- **Pros:** Single extension.
- **Cons:** Hard to manage native modules dynamically in VS Code (security, compatibility).

### Option 3: WebAssembly (sqlite-wasm)

Use `sql.js` or `sqlite-wasm` instead of the native `sqlite3` module.

- **Pros:** No native bindings, runs everywhere (including web), reasonable size.
- **Cons:** Performance might be lower for huge DBs (though likely fine for "preview"). File system access needs to be handled carefully (Node.js FS vs browser FS).

## Design Plan (Wasm Approach)

1.  Investigate `sqlite-wasm` or `sql.js`.
2.  Implement `SQLiteConnector` using the Wasm-based driver.
3.  Bundle the Wasm file (usually a few MBs, but consistent across platforms).

## Implementation Steps

1.  Research `sqlite-wasm` performance and file system limitations.
2.  Prototype a Wasm-based connector.
3.  Benchmark size impact.
4.  Implement and release.

## Alternatives Considered

- **Native bundling:** Accepted for now that it's too big/complex.

---

**Decision:** Investigate Option 3 (Wasm) first, as it solves the native binding issue and keeps the extension portable.
