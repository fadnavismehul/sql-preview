## 2024-05-22 - Local Server CORS Vulnerability

**Vulnerability:** The local daemon server (`src/server/Daemon.ts`) was configured with `app.use(cors())`, which enabled CORS for all origins (`*`). This allowed any website visited by the user to interact with the local daemon via CSRF, potentially executing arbitrary SQL queries or accessing sensitive session data if the daemon exposes such capabilities.

**Learning:** Local servers intended for use by local tools (like VS Code extensions) should not enable CORS for all origins. Even though they listen on `localhost`, browsers allow websites to send requests to `localhost`. The `cors` middleware with default settings is dangerous in this context.

**Prevention:** Do not use the `cors` middleware for local servers unless strictly required for specific web-based clients. If required, restrict `origin` to a safelist of trusted domains. For local-only tools, CORS should be disabled (meaning the browser will block cross-origin requests by default).
