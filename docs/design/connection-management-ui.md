# Connection Management UI & Architecture

## Overview

This document outlines the design for the Connection Management interface in SQL Preview and the underlying architecture that supports it. A key goal is to separate the _Core_ connection logic (Daemon) from the _UI_ presentation (VS Code Extension), enabling future headless and remote deployments.

## Architecture: Tiered Approach

The system is divided into two primary layers: Current (Daemon) and Presentation (VS Code / Web UI).

### 1. Core Layer (Daemon)

The Daemon (`src/server/Daemon.ts`) is the source of truth for all connection state and logic. It is responsible for:

- **Profile Persistence**: Reading/writing configuration files (e.g., `~/.sql-preview/config.json`).
- **Credential Management**: Securely handling passwords (via system keychain or temporary session storage).
- **Connection Lifecycle**: Initializing, testing, and closing connections to databases (Trino, DuckDB, etc.).
- **Headless Operation**: The Daemon must be capable of running without any GUI, fully configurable via environment variables or configuration files. This is critical for the `npx` deployment node.

**Key Components:**

- `ConnectionManager`: Orchestrates profiles and credentials.
- `IProfileStore`: Interface for config sources (File, Env, Workspace).
- `ICredentialStore`: Interface for secret storage (Keytar, Memory).

### 2. Presentation Layer (VS Code Extension / Webview)

The VS Code Extension serves as a UI client for the Daemon. It does _not_ directly manage connection state or files.

- **View-Only**: Displays the state provided by the Daemon.
- **Intent-Based**: Sends commands (e.g., `saveConnection`, `testConnection`) to the Daemon.
- **React Webview**: The "Connections" page is built as a React webview, communicating with the Extension Host, which relays messages to the Daemon.

## Credential Architecture: Hybrid Model

To balance security (VS Code integration) with flexibility (Headless/CI), we employ a hybrid strategy.

### A. Runtime Injection (VS Code Mode)

In the standard extension workflow:

1.  **Storage**: Passwords reside in **VS Code SecretStorage** (system keychain encrypted by VS Code).
2.  **Injection**: When a query is run or a connection tested, the Extension retrieves the secret and **injects** it into the request sent to the Daemon.
3.  **Persistence**: The Daemon does _not_ persist these secrets. It effectively treats the request as having "transient credentials."

### B. Autonomous Resolution (Headless Mode)

When the Daemon runs independently (e.g., `npx sql-preview-server`):

1.  **Storage**: Credentials must be available to the Daemon process itself.
2.  **Sources**:
    - **Environment Variables**: `SQL_PREVIEW_CONN_MYDB_PASSWORD=...`
    - **Daemon Keychain**: (Optional) Direct use of `keytar` if running on a desktop without VS Code.
    - **Credential Process**: (Future) Shell command to fetch secret (e.g., `aws secretsmanager get-secret ...`).
3.  **Resolution**: If a request comes in _without_ injected credentials (e.g. from a generic MCP client), the Daemon attempts to resolve them from these sources.

## "Connections" Page Design

The Connections page provides a dedicated workspace for users to manage their database access.

### Features

1.  **Connection List**:
    - Displays all configured connections (User & Workspace levels).
    - **Status Indicators**:
      - 🟢 **Active**: Connection verified and ready.
      - 🔴 **Error**: Configuration or network issue.
      - ⚪ **Idle**: Not currently connected.
    - **Source Icon**: Indicates where the config comes from (File, Env Var).

2.  **Actions**:
    - **Test Connection**: A prominent button for each profile to immediately verify connectivity.
    - **Add New**: Wizard-style form to create a new profile.
    - **Edit/Duplicate**: Modify existing profiles.

3.  **Detailed Status**:
    - Clicking a connection reveals detailed status info (e.g., "Connected to Trino v435 via HTTPS").

### Mockup Structure

```text
+-------------------------------------------------------+
|  Connections                                      [+] |
+-------------------------------------------------------+
|                                                       |
|  [Trino] Production Cluster                 [Test] ⚙️ |
|  🟢 Connected (12ms)                                  |
|                                                       |
|  [DuckDB] Local Analysis                    [Test] ⚙️ |
|  🔴 Error: File not found                             |
|                                                       |
|  [Postgres] Legacy DB                       [Test] ⚙️ |
|  ⚪ Idle                                              |
|                                                       |
+-------------------------------------------------------+
```

## Headless & Remote Scenarios

In a headless environment (e.g., a remotely deployed MCP server via `npx`):

1.  **No UI**: The "Connections" page is not available.
2.  **Configuration**: Connections are defined purely via Interface `IProfileStore` implementations (e.g., Environment Variables like `SQL_PREVIEW_CONN_1_URL`).
3.  **Transparency**: The Daemon need not know if a UI exists. It simply exposes its `listProfiles` and `testConnection` capabilities via the MCP protocol or API.
4.  **Remote Management**: Future capability could allow a local VS Code instance to connect to a _remote_ Daemon and use the local UI to configure the remote server's file-based profiles (if permissions allow).

## VS Code Extension as a "Separate UI Layer"

The VS Code Extension should be treated as just one of many possible clients.

- **Decoupling**: The extension should not import `Daemon` classes directly for logic. All interactions should go through defined IPC/HTTP channels.
- **Benefit**: This forces the Daemon API to be robust and complete, enabling other clients (like a standalone Electron app or a CLI) to have full parity.
