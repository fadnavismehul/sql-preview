# UX Brainstorming: Querying CSVs with DuckDB

**Goal**: Enable users to seamlessly query local CSV/JSON/Parquet files using the SQL Preview extension backed by DuckDB.

## Option 1: The "Direct Query" Approach (Zero-Config)

_The user treats the file system as their database._

**Workflow:**

1. User opens a new or existing `.sql` file in VS Code.
2. User writes standard DuckDB SQL referencing the file path.

   ```sql
   -- Relative path (from workspace root)
   SELECT * FROM './data/sales.csv' WHERE amount > 100;

   -- Absolute path
   SELECT * FROM '/Users/mehul/downloads/report.parquet';

   -- Remote URL (DuckDB feature)
   SELECT * FROM 'https://domain.com/data.csv';
   ```

3. User presses `Cmd+Enter` (Run Query).
4. Results appear in the "SQL Preview" grid.

**Pros:**

- **No Setup**: No need to "import" or "connect" anything.
- **Natural**: Uses standard DuckDB syntax.
- **Flexible**: Works for any file on disk.

**Cons:**

- **Path Pain**: Users might struggle with relative paths (is it relative to the `.sql` file or the Workspace Root?). _Solution: We enforce Workspace Root or provide a variable like `${currentDir}`._
- **Discoverability**: Users might not know they can do this.

---

## Option 2: "Query File" Context Menu (The Shortcut)

_The user starts from the file explorer._

**Workflow:**

1. User right-clicks a `.csv`, `.json`, or `.parquet` file in the VS Code File Explorer.
2. Selects **"SQL Preview: Query File"**.
3. Extension opens a _new_ temporary SQL file (e.g., `Preview-sales.sql`).
4. Pre-fills standard boilerplate:
   ```sql
   -- Querying: /path/to/sales.csv
   SELECT *
   FROM '/path/to/sales.csv'
   LIMIT 500;
   ```
5. Auto-runs the query (optional) or waits for `Cmd+Enter`.

**Pros:**

- **High Discoverability**: User sees the option right on the file.
- **No Path Pain**: Extension handles the absolute path generation.
- **Immediate Value**: One click to see data.

**Cons:**

- Creates temporary editors that might clutter the workspace if used frequently.

---

## Option 3: Virtual "Auto-Mount" via Settings

_The user defines persistent "Tables" from files._

**Workflow:**

1. User updates `.vscode/settings.json`:
   ```json
   "sqlPreview.duckdb.mounts": {
       "users": "./data/users.csv",
       "orders": "./data/orders.parquet"
   }
   ```
2. User writes SQL using the _table names_:
   ```sql
   SELECT u.name, o.amount
   FROM users u
   JOIN orders o ON u.id = o.user_id;
   ```

**Pros:**

- **Cleaner SQL**: Abstraction over file paths.
- **Reusable**: Configure once, use everywhere in the project.

**Cons:**

- **Config Friction**: Requires editing JSON / settings.
- **Overhead**: "Yet another thing to configure".

---

## Recommendation: The "Hybrid" Flow

We should implement **Option 1 (Direct Query)** as the core capability because it requires no extra UI work and is "standard DuckDB".

Then, we implement **Option 2 (Context Menu)** as a _shortcut_ to generate those queries for the user.

**Proposed Implementation:**

1.  **Core**: Ensure `DuckDbConnector` resolves relative paths like `./` correctly (relative to VS Code Workspace Root).
2.  **UI**: Add a command `sqlPreview.queryFile` that takes a file URI, generates the `SELECT * FROM '...'` SQL, and opens it.
3.  **Docs**: Show examples of querying CSV/JSON directly in the README.

### Technical Detail: Path Resolution

DuckDB (Node) runs in a process. Its `cwd` determines how `./` is resolved.

- We must set the `DuckDBInstance` or the worker process `cwd` to the user's `workspaceFolder`.
- OR, we (the extension) intercept path strings in SQL and rewrite them (Riskier).
- Better: We teach users to use `${workspaceFolder}` or simply ensure the Daemon is spawned with the correct `cwd`.
