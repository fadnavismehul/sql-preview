# RFC-008: SQLite Support Strategy

**Feature Name:** SQLite Support
**Status:** Accepted
**Created:** 2026-02-13

## Summary

Re-introduce SQLite support to the SQL Preview extension without significantly increasing the package size for users who only need Trino/Presto support, by leveraging WebAssembly (`sql.js`).

## Motivation

SQLite support was removed in v0.5.9 to resolve packaging issues and reduce the VSIX size (from ~13MB to ~1.5MB). The `sqlite3` dependency requires native bindings, which complicates packaging and increases download size. However, SQLite is a popular database for local development and testing, and supporting it is valuable.

## Proposed Solution

### Option 3: WebAssembly (sql.js) (Accepted Phase)

Use `sql.js` instead of the native `sqlite3` module.

- **Pros:** No native bindings, portable across all operating systems without recompilation. Reasonable footprint.
- **Cons:** Files must be loaded into memory, which may cause issues for extremely large databases, though perfectly fine for typical lightweight "preview" use cases.

## Design Plan (Wasm Approach)

1. Add `sql.js` as a standard dependency.
2. Implement `SQLiteConnector` to load `.db` or `.sqlite` files completely into memory as a `Uint8Array`.
3. Instantiate `initSqlJs().Database` and execute the user's query against this in-memory database.
4. Extract `columns` and `data` and return them as yielding `QueryPage`s inline with the `IConnector` interface.

## Implementation Steps

1. Install `sql.js` and remove vestigial references to native `sqlite3`.
2. Rewrite `SQLiteConnector.ts` to utilize the synchronous `sql.js` API.
3. Update unit tests in `SQLiteConnector.test.ts` to mock/test the new WASM-based approach.

---

**Decision:** Accepted Option 3 (Wasm). Implementation will proceed using `sql.js`.
