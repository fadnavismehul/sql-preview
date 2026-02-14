## 2026-01-31 - [CSV Injection (Formula Injection)]

**Vulnerability:** The `ExportService` class did not sanitize cell values starting with `=, +, -, @`, allowing execution of formulas in exported CSV files when opened in spreadsheet software (like Excel).
**Learning:** Even when correctly escaping CSV delimiters (quotes), cell contents can still trigger formula execution. Sanitization must precede delimiter escaping. Checking `!isNaN(Number(val))` helps preserve valid numeric data while escaping potential formulas.
**Prevention:** Always check if a cell value starts with dangerous characters (`=, +, -, @`) before exporting to CSV/Excel. If it does, verify if it is a safe number; otherwise, prepend a single quote (`'`) to force text interpretation.

## 2026-02-02 - [Unauthenticated Local RCE via MCP]

**Vulnerability:** The Daemon HTTP server bound to `0.0.0.0` and enabled CORS, allowing any network device or malicious website to execute SQL queries via the MCP endpoint without authentication.
**Learning:** Local development tools often expose powerful capabilities (RCE/SQL execution). Binding to `0.0.0.0` by default is dangerous. Auto-registering sessions without authentication bypasses access controls.
**Prevention:** Bind local servers strictly to `127.0.0.1`. Disable CORS for local daemons unless necessary. Use cryptographically secure session IDs (`crypto.randomUUID`) and require authentication for sensitive operations.

## 2026-02-03 - [Arbitrary File Access via MCP]

**Vulnerability:** The `run_query` MCP tool allowed an optional `connectionProfile` override, which enabled an attacker (or confused LLM) to specify a custom SQLite database path. This could be used to read or potentially corrupt arbitrary files on the system by treating them as SQLite databases.
**Learning:** Providing "full flexibility" in tools exposed to LLMs can bridge the gap to RCE or arbitrary file access. Overrides that allow specifying file paths or connection strings are dangerous if not strictly validated or sandboxed.
**Prevention:** Remove the ability to override connection details in public/exposed tools. Force the use of pre-configured, user-vetted `connectionId`s. Implement a `list_connections` tool to allow discovery of valid resources without exposing the ability to create arbitrary new ones.
