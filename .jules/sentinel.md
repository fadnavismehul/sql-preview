## 2026-01-31 - [CSV Injection (Formula Injection)]

**Vulnerability:** The `ExportService` class did not sanitize cell values starting with `=, +, -, @`, allowing execution of formulas in exported CSV files when opened in spreadsheet software (like Excel).
**Learning:** Even when correctly escaping CSV delimiters (quotes), cell contents can still trigger formula execution. Sanitization must precede delimiter escaping. Checking `!isNaN(Number(val))` helps preserve valid numeric data while escaping potential formulas.
**Prevention:** Always check if a cell value starts with dangerous characters (`=, +, -, @`) before exporting to CSV/Excel. If it does, verify if it is a safe number; otherwise, prepend a single quote (`'`) to force text interpretation.

## 2026-02-02 - [Unauthenticated Local RCE via MCP]

**Vulnerability:** The Daemon HTTP server bound to `0.0.0.0` and enabled CORS, allowing any network device or malicious website to execute SQL queries via the MCP endpoint without authentication.
**Learning:** Local development tools often expose powerful capabilities (RCE/SQL execution). Binding to `0.0.0.0` by default is dangerous. Auto-registering sessions without authentication bypasses access controls.
**Prevention:** Bind local servers strictly to `127.0.0.1`. Disable CORS for local daemons unless necessary. Use cryptographically secure session IDs (`crypto.randomUUID`) and require authentication for sensitive operations.

## 2026-05-23 - [SSRF via Port Injection]
**Vulnerability:** The `ResultsMessageHandler` processed unvalidated user-controlled `port` values to construct `http.get` URLs, allowing an attacker to inject characters like `@evil.com` and redirect connection to an arbitrary server (SSRF).
**Learning:** Even numeric parameters like `port` must be strictly validated as integers within range (1-65535) before use, as they can be manipulated to alter the semantics of URL construction if injected as strings.
**Prevention:** Implement strict validation helpers like `validatePort` that check type, format (only digits), and range before using numeric inputs in sensitive contexts like network requests or file system operations.
