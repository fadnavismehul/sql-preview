## 2024-05-22 - [Local Server CORS Risk]
**Vulnerability:** The MCP server (local Express server) used `cors()` which allows all origins (`*`) by default. This allowed any malicious website visited by the user to potentially execute SQL queries against the user's local database connection via the MCP API.
**Learning:** Local servers intended for use by local agents/tools (like MCP clients) should strictly disable CORS or whitelist specific origins. Broad CORS on localhost is a major CSRF/interaction vector.
**Prevention:** Do not use `cors` middleware on local servers unless explicitly required for a known web-based client, and even then, restrict the origin.
