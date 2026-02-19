# RFC-010: Modular Connection Profiles

**Status:** Implemented
**Created:** 2026-02-18
**Owner:** Core Team

## Summary

This RFC proposes a robust, modular system for managing database connection profiles in SQL Preview. It aims to decouple profile persistence, credential management, and current runtime state, enabling support for multiple database types (Trino, Postgres, SQLite) and diverse configuration sources (User config, Workspace config, Environment variables).

## Motivation

Currently, connection management is handled by `FileConnectionManager`, which combines file I/O, rudimentary in-memory credential masking, and profile retrieval into a single class. As we expand to support Postgres and SQLite, and potentially move towards more complex agentic workflows, this monolithic approach presents several limitations:

1.  **Security**: Passwords are manually stripped and stored in memory, which is lost on restart. There is no integration with secure OS storage.
2.  **Configuration Hierarchy**: There is no support for overriding configurations via environment variables or workspace-specific settings.
3.  **Tightly Coupled Concerns**: The persistence layer is tightly coupled with the runtime representation of a connection.
4.  **Scalability**: Adding new connector types requires updating the single profile schema and manager logic potentially in multiple places.
5.  **Node.js Independence & DuckDB**: With the introduction of the optional DuckDB connector (requiring a native node module), strict isolation is needed to ensure the extension works in environments where the system Node.js is missing or incompatible. The connection profile system must handle cases where a connector is "configured but unavailable."

## Proposed Architecture

We propose breaking down connection management into distinct, composable components.

### 1. Connection Profile Schema

The `ConnectionProfile` type is already a discriminated union. We will formalize this schema and add versioning to the persistence layer to support future migrations.

```typescript
export interface BaseProfile {
  id: string; // UUID
  name: string; // Display Name
  type: ConnectorType; // 'trino' | 'postgres' | 'sqlite'
  // ... common fields (host, port, ssl)
}

// Connector-specific extensions remain as they are in types.ts
```

### 2. Profile Store Interface (`IProfileStore`)

We will introduce an interface for retrieving raw profile configurations. This allows for multiple sources of truth.

```typescript
interface IProfileStore {
  /**
   * Returns all profiles known to this store.
   * Note: These profiles may not have resolved credentials yet.
   */
  loadProfiles(): Promise<ConnectionProfile[]>;

  /**
   * Persists a profile (if the store supports writing).
   */
  saveProfile(profile: ConnectionProfile): Promise<void>;

  /**
   * Deletes a profile.
   */
  deleteProfile(id: string): Promise<void>;
}
```

**Proposed Implementations:**

- **`FileProfileStore`**: Reads/writes to `~/.sql-preview/config.json`. This is the primary persistent store for user-created profiles.
- **`EnvProfileStore`**: (Read-only) Scans `process.env` for variables like `SQL_PREVIEW_CONN_PRIMARY_HOST`, etc., allowing for 12-factor app configuration.
- **`WorkspaceProfileStore`**: (Optional future) Reads a `.sql-preview.json` from the current workspace root.

### 3. Credential Management (`ICredentialStore`)

We will separate credential storage from profile configuration.

```typescript
interface ICredentialStore {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<void>;
}
```

- **`KeytarCredentialStore`**: Uses `keytar` (system keychain) for production.
- **`MemoryCredentialStore`**: Fallback for development/headless environments (current behavior, but encapsulated).
- **`CommandCredentialStore`**: (Future) Executes a user-defined shell command to retrieve the password (similar to AWS `credential_process`). This enables integration with 1Password, LastPass, Vault, or custom scripts without modification to the Daemon.

### 4. Credential Strategy & "Injection" Pattern

The system must support two distinct modes of operation:

1.  **Iteractive (VS Code Extension)**:
    - **Storage**: Secrets are stored in VS Code's `SecretStorage` (User Keychain).
    - **Runtime**: The extension **injects** credentials into the Daemon with every request (via `run_query` arguments).
    - **Benefit**: The Daemon remains stateless regarding secrets, reducing surface area.

2.  **Headless / Autonomous (MCP Server)**:
    - **Storage**: Secrets are retrieved by the Daemon itself via `EnvProfileStore` or `KeytarCredentialStore`.
    - **Runtime**: The Daemon resolves missing credentials on-demand.
    - **Benefit**: Enables `npx sql-preview-server` to work in CI/CD or remote environments.

The `ConnectionManager` logic will prioritize:

1.  Injected Credentials (Request-scoped)
2.  Environment Variables
3.  Secure Storage (Keytar)

### 5. Connection Manager (`ConnectionManager`)

The `ConnectionManager` becomes the orchestrator.

- **Initialization**: It accepts a list of `IProfileStore` instances (ordered by priority) and an `ICredentialStore`.
- **Profile Resolution**:
  1.  Aggregates profiles from all stores.
  2.  Merges duplicates (e.g. Env var overrides file config for same ID).
  3.  Enriches profiles with credentials fetched from `ICredentialStore`.
- **Runtime State**: capabilities to "test" a connection before returning it.

### 6. API Changes

The `Daemon` will initialize the `ConnectionManager` with the appropriate stores.

```typescript
// Daemon.ts initialization
const credentialStore = isHeadless ? new MemoryCredentialStore() : new KeytarCredentialStore();
const fileStore = new FileProfileStore(CONFIG_DIR);
const envStore = new EnvProfileStore();

this.connectionManager = new ConnectionManager(
  [envStore, fileStore], // Priority: Env > File
  credentialStore
);
```

### 7. UI/UX & Headless Transparency

A key requirement is that the "Connections" page in VS Code is merely a _view_ into the Daemon's state.

- **Tiered Architecture**: The VS Code extension acts as a thin UI layer. The Core logic resides entirely in the Daemon.
- **Headless Support**: The Daemon must support "headless" operation (e.g., `npx sql-preview-server`) where no UI is present. In this mode, connections are configured solely via `IProfileStore` sources (File, Env).
- **Connections Page**: A specific "Connections" view will be added to the extension:
  - **Status Dashboard**: View connectivity status of all profiles.
  - **Test Connection**: Button to verify credentials and network path.
  - **Transparency**: The availability of this UI does not couple the Daemon to VS Code.

See `docs/design/connection-management-ui.md` for detailed UI mockups and architecture.

## Security Considerations

- **Credential Isolation**: Passwords are never serialized to `config.json`. They are stored in the OS keychain keyed by Profile ID.
- **Environment Variables**: Secrets provided via env vars (e.g. `SQL_PREVIEW_CONN_PASSWORD`) are kept in memory and never written to disk.

## Migration Plan

1.  **Refactor**: Rename `FileConnectionManager` to `ConnectionManager` and extract the file I/O logic to `FileProfileStore`.
2.  **Interface**: Implement `IProfileStore` and `ICredentialStore` interfaces.
3.  **Keytar**: Introduce optional `keytar` dependency for secure storage.
4.  **Update Daemon**: wiring up the new components.
5.  **Backward Compatibility**: The `FileProfileStore` will transparently read the existing `config.json` format.

## Verification

- **Unit Tests**: Mock `IProfileStore` and `ICredentialStore` to verify `ConnectionManager` logic (merging, precedence, password enrichment).
- **Integration**: Verify `FileProfileStore` correctly reads/writes `config.json`.
- **Manual**: Verify that profiles created in the UI persist across restarts and that passwords (if using keychain) are retained.
