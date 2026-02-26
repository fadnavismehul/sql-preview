# RFC-014: Realtime Websocket Interface for Agentic Data Streaming

**Feature Name:** Realtime Websocket Interface
**Status:** Proposed
**Created:** 2026-02-26
**Owner:** Core Team

## Summary

This RFC proposes adding a persistent, bi-directional Websocket interface to the SQL Preview Daemon. Inspired by modern agentic architectures (like OpenAI's Realtime Websocket API), this interface will allow AI agents and front-end clients to maintain a continuous stateful connection, stream large analytical queries efficiently, and receive asynchronous push events (like schema changes or query completion statuses) without the overhead of HTTP polling.

## Motivation

As we pivot towards a fully headless, agent-first architecture (incorporating MCP connectors from RFC-013), the communication layer between the Daemon and the "Agent Brain" becomes the critical bottleneck.

Currently, the system relies on standard HTTP REST calls or basic SSE (Server-Sent Events) for streaming. While SSE is good for one-way data flow (Daemon -> Client), it lacks true bi-directional real-time capabilities.

1. **Stateful Agent Workflows:** Agents often need to rapidly iterate: inspect schema, run a quick `LIMIT 10` probe, refine the query, and fetch heavy results. Opening and closing HTTP connections for every step adds significant TLS and TCP handshake latency.
2. **Interruptibility:** If an agent runs a massive `JOIN` that will take 5 minutes, it needs a fast, reliable way to send an interrupt/abort signal mid-stream. Websockets handle multiplexing control signals and data streams elegantly.
3. **Bi-directional Streaming:** Modern agents (like OpenAI's advanced models) are moving towards persistent websocket connections for low-latency reasoning. Our data daemon should speak the same language.
4. **Push Notifications:** The Daemon needs to proactively notify connected agents about background events (e.g., "The SQLite database file was modified locally", or "Connector X just crashed and restarted").

## Proposed Architecture

Instead of inventing a custom JSON protocol, we will utilize the official **Model Context Protocol (MCP)** and run it over a WebSocket connection. The Daemon already implements a robust `DaemonMcpServer` and `DaemonMcpToolManager` containing tools like `run_query` and `get_tab_info` exposed via SSE and Stdio. We will enhance this by adding the `@modelcontextprotocol/sdk/server/ws.js` transport.

### 1. WebSocket Transport for the Existing MCP Server (The Interface)

- **Handshake:** The agent connects to `ws://localhost:XXXX/mcp`.
- **Authentication:** Standard authentication tokens can be passed in initial headers or as a first initialization message.
- **Bi-directional JSON-RPC:** The connection will transport standard MCP JSON-RPC 2.0 messages. Agents can instantly use existing tools (`run_query`, `list_sessions`) and subscribe to resource changes without any additional custom API client logic.

### 2. Dual-Track Data Plane (The Engine)

For heavy analytical workloads, JSON-RPC (even over WebSockets) will choke on millions of rows. We must establish a dual-track system working in tandem with RFC-013:

- **Control Plane (MCP over WebSockets):** Agents use the WebSocket MCP connection to tell the Daemon to start a query.
- **Data Plane (Apache Arrow IPC):** For actual row data, rather than sending JSON arrays over the WebSocket, the underlying database connector (RFC-013) should return a URI pointing to a local Named Pipe, Shared Memory segment, or a gRPC stream containing binary **Apache Arrow** data. The Daemon can then stream this binary data directly to the client (or the client can connect to the pipe directly), ensuring zero-copy, high-throughput delivery.

## Implementation Steps

1. **WebSocket Server Integration:** Integrate the `ws` package into the existing `Daemon.ts` Express/HTTP server setup.
2. **Mount MCP Transport:** Create an instance of `WebSocketServerTransport` from the official MCP SDK.
3. **Shared MCP Logic:** Mount the existing `DaemonMcpServer` onto this new WebSocket transport. Ensure session state is maintained across the WebSocket lifecycle.
4. **Data Plane Spike (Follow-up):** Prototype streaming DuckDB/Postgres results to a local named pipe format using Apache Arrow, and have the MCP `run_query` tool return the URI to that pipe instead of JSON data.

## Relationship to RFC-013 (MCP Connectors)

This RFC (RFC-014) handles the "Northbound" traffic: **Agent <-> Daemon**.
RFC-013 handles the "Southbound" traffic: **Daemon <-> Database Connectors**.

By standardizing both ends on the Model Context Protocol, we achieve a highly scalable, event-driven architecture. Agents talk to the Daemon instantly over standard MCP WebSockets, and the Daemon orchestrates out-of-process MCP Connectors to do the heavy lifting safely.

## Unresolved Questions

- Do we want to completely replace the existing HTTP SSE (`/mcp`) endpoint with WebSockets, or run them side-by-side as dual transports?
- How complex is it to generate temporary Unix named pipes cross-platform (Windows vs macOS/Linux) for the binary Apache Arrow stream?
