# RFC-024: Connector Testing Standards and Retrofit

**Status:** Proposed  
**Created:** 2026-03-03  
**Owner:** Core Team  
**Priority:** P0 (blocks quality gate for launch)

---

## Problem

The MySQL connector (RFC-019) established a comprehensive 3-layer testing approach: unit tests with mocked drivers, integration tests against real containers via `testcontainers`, and a CLI smoke test. This methodology does not yet exist for any of the four connectors that shipped before it:

| Connector  | Package                 | Unit tests                 | Integration tests | Test scripts |
| ---------- | ----------------------- | -------------------------- | ----------------- | ------------ |
| PostgreSQL | `sql-preview-postgres`  | ❌                         | ❌                | ❌           |
| SQLite     | `sql-preview-sqlite`    | ❌                         | ❌                | ❌           |
| DuckDB     | `sql-preview-duckdb`    | ❌                         | ❌                | ❌           |
| Trino      | `src/connectors/trino/` | ⚠️ 2 partial cases in root | ❌                | ❌           |

Shipping connector code without a test suite creates several problems:

- Regressions are caught late (or not at all) during manual testing
- The `IConnector` interface cannot be validated for compliance without tests
- New contributors have no safety net when modifying connector behavior
- Error code → error class mappings are untested
- Type mapping correctness (e.g. `pg` OID → SQL Preview type) is unverified

---

## Goal

Retrofit the testing methodology established in RFC-019 to all existing connectors, bringing each up to the same coverage standard before the P0 launch (RFC-023).

---

## Testing Standard (from RFC-019)

### Layer 1 — Unit Tests (always required, no infrastructure)

**Location:** `packages/<connector>/src/__tests__/<Connector>.test.ts`  
**Runner:** `npm test` inside the package  
**Infrastructure:** None — driver mocked with `jest.mock()`

Mandatory test groups for every connector:

| Group                    | Cases                                                                            |
| ------------------------ | -------------------------------------------------------------------------------- |
| `validateConfig`         | required fields (each absent → specific error), all fields present → `undefined` |
| `runQuery` — success     | happy path: yields QueryPage with correct `columns`, `data`, `stats.rowCount`    |
| `runQuery` — empty       | zero-row result: yields page with `data: []`                                     |
| `runQuery` — auth error  | driver auth error → `AuthenticationError` thrown                                 |
| `runQuery` — conn error  | network error (ECONNREFUSED/equivalent) → `ConnectionError` thrown               |
| `runQuery` — query error | bad SQL → `QueryError` thrown                                                    |
| `runQuery` — cleanup     | connection is closed even when query throws                                      |
| `testConnection`         | success path → `{success: true}`; failure → `{success: false, error: ...}`       |
| Type mapping             | each mapped type constant → expected SQL Preview type label                      |

### Layer 2 — Integration Tests (required, gated, Docker/Colima)

**Location:** `packages/<connector>/src/__tests__/<Connector>.integration.test.ts`  
**Runner:** `npm run test:integration` inside the package  
**Infrastructure:** `@testcontainers/<db>` module + Docker (Colima on macOS)

Each connector must test against a real database instance:

| Test group       | What to verify                                                                 |
| ---------------- | ------------------------------------------------------------------------------ |
| `testConnection` | valid creds succeed; wrong password fails; unreachable host fails              |
| `runQuery`       | `SELECT 1` round-trip; multi-row result; NULL handling; stats.rowCount correct |
| Type round-trip  | create table with all key types, query, verify SQL Preview type label          |
| `listSchemas`    | real schemas visible; system schemas excluded                                  |
| `listTables`     | base tables and views returned with correct type labels                        |
| `describeTable`  | column info correct; `isPrimaryKey` set; ordinal position order                |

### Layer 3 — CLI Smoke Test (manual / CI optional)

Spawn the built binary with a simple `SELECT 1` and parse the JSON output.

---

## Proposed Changes per Connector

### PostgreSQL (`sql-preview-postgres`)

**testcontainers module:** `@testcontainers/postgresql`  
**Container image:** `postgres:16-alpine`  
**Driver to mock:** `pg` (Pool or Client)

New files:

- `packages/sql-preview-postgres/src/__tests__/PostgreSQLConnector.test.ts`
- `packages/sql-preview-postgres/src/__tests__/PostgreSQLConnector.integration.test.ts`

`package.json` additions:

```json
{
  "scripts": {
    "test": "jest --testPathPattern='__tests__/PostgreSQLConnector\\.test\\.ts'",
    "test:integration": "jest --testPathPattern='__tests__/PostgreSQLConnector\\.integration\\.test\\.ts' --testTimeout=120000"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10.13.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "@types/jest": "^29.0.0"
  }
}
```

Type mapping targets (`pg` OID constants):

- `20` (int8), `21` (int2), `23` (int4) → `integer`
- `700` (float4), `701` (float8), `1700` (numeric) → `number`
- `1082` (date) → `date`
- `1114` (timestamp), `1184` (timestamptz) → `timestamp`
- `16` (bool) → `boolean`
- all others → `string`

---

### SQLite (`sql-preview-sqlite`)

**Container:** None needed — SQLite uses file-based databases. Integration tests create an in-memory `:memory:` database instead of using testcontainers.  
**Driver to mock:** `sql.js` (WebAssembly) or the native `sqlite3` binding

New files:

- `packages/sql-preview-sqlite/src/__tests__/SQLiteConnector.test.ts`
- `packages/sql-preview-sqlite/src/__tests__/SQLiteConnector.integration.test.ts` (in-memory DB, no Docker)

> [!NOTE]
> SQLite integration tests don't require Docker — `sql.js` (already used by the connector) runs entirely in-process. The integration test simply creates an in-memory DB, inserts data, and queries it. These tests can therefore run in both `npm test` and `npm run test:integration`.

---

### DuckDB (`sql-preview-duckdb`)

**Container:** None needed — DuckDB also uses in-memory databases.  
**Driver to mock:** `@duckdb/node-api` (native Node binding)

New files:

- `packages/sql-preview-duckdb/src/__tests__/DuckDBConnector.test.ts`
- `packages/sql-preview-duckdb/src/__tests__/DuckDBConnector.integration.test.ts` (in-memory DuckDB, no Docker)

> [!NOTE]
> DuckDB is natively embedded — no container needed. Similar to SQLite, integration tests can use an in-memory `DuckDBInstance`. These tests can also run in standard `npm test`.

---

### Trino (`src/connectors/trino/`)

**testcontainers module:** `testcontainers` generic container  
**Container image:** `trinodb/trino:latest`  
**Driver to mock:** `axios` (already mocked in root `setup.ts`)

Existing coverage (`src/test/connectors/TrinoConnector.test.ts`): 2 cases — ECONNREFUSED propagation and schema/catalog validation. This must be expanded to the full standard.

New files:

- `src/test/connectors/TrinoConnector.unit.test.ts` — full standard coverage (replace / extend existing partial tests)
- `src/test/integration/TrinoConnector.integration.test.ts` — real Trino container (generic testcontainers)

> [!IMPORTANT]
> Trino's integration tests are significantly heavier (container startup ~60s, JVM warmup). The `testTimeout` should be set to `300000` (5 min) and the test should be documented as optional/slow in CI.

---

## Package.json Template

All connector packages adopt the same script interface:

```json
{
  "scripts": {
    "test": "jest --testPathPattern='__tests__/<Connector>\\.test\\.ts' --passWithNoTests",
    "test:integration": "jest --testPathPattern='integration' --testTimeout=120000 --passWithNoTests --forceExit",
    "typecheck": "tsc --noEmit"
  }
}
```

---

## Root `jest.config.js` Changes

Already done as part of RFC-019 impl: `/packages/` is excluded from root jest — each package runs its own jest independently.

---

## Root `src/test/setup.ts` Changes

Virtual mocks for the new drivers are added as part of each connector implementation so the root test suite never fails due to missing native driver binaries.

---

## Trino Testcontainers Note

Trino requires a local port and coordinator config at startup. The integration test must:

1. Use `GenericContainer` from `testcontainers` (no `@testcontainers/trino` exists)
2. Expose port 8080
3. Wait for `"SERVER_STARTED"` log message before running tests
4. Disable authentication (default Trino config)
5. Set a long startup timeout (120s minimum)

---

## Acceptance Criteria

For each connector, the RFC is considered done when:

- [ ] `npm test` in the package runs and passes all unit tests (≥ 10 tests)
- [ ] `npm run test:integration` passes with a real running database (≥ 10 tests)
- [ ] All `IConnector` method paths are covered: `validateConfig`, `runQuery`, `testConnection`, `listSchemas`, `listTables`, `describeTable`
- [ ] Error classification is verified: `AuthenticationError`, `ConnectionError`, `QueryError`
- [ ] Type mapping is verified for the connector's key native types
- [ ] Root project `npm test` remains green (228 tests, no regressions)

---

## Interdependencies

- **Depends on:** RFC-019 (MySQL) — establishes the template this RFC follows
- **Depends on:** RFC-016 (Schema Metadata API) — `listSchemas`, `listTables`, `describeTable` are the interface these tests validate
- **Enables:** RFC-020, RFC-021, RFC-022 — new connectors adopt this same standard from day one
- **Enables:** RFC-023 (Distribution) — a test suite provides confidence that the published package is correct

---

## Effort Estimate

| Connector  | Unit tests | Integration tests     | Total effort |
| ---------- | ---------- | --------------------- | ------------ |
| PostgreSQL | ~2h        | ~2h                   | ~4h          |
| SQLite     | ~2h        | ~1h (in-process)      | ~3h          |
| DuckDB     | ~2h        | ~1h (in-process)      | ~3h          |
| Trino      | ~3h        | ~4h (heavy container) | ~7h          |
| **Total**  |            |                       | **~17h**     |
