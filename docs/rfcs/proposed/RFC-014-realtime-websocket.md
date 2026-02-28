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

We will implement a `ws://` and `wss://` endpoint on the existing headless Daemon, utilizing a standardized JSON-based event protocol (similar to the OpenAI Realtime API).

### Connection Lifecycle

1. **Handshake:** The agent connects to `ws://localhost:XXXX/v1/realtime`.
2. **Authentication:** Initial frame contains session/auth tokens.
3. **Session State:** The connection is pinned to a specific `sessionId` internally, retaining context across messages.

### Message Protocol

Messages will flow in both directions using a strict JSON schema.

**Client -> Server (Agent Requests):**

- `session.update`: Modify active connection profile.
- `query.execute`: Start streaming a SQL query.
- `query.abort`: Cancel an actively running query.
- `schema.introspect`: Request current database structure.

**Server -> Client (Daemon Responses):**

- `query.data.chunk`: A streamed batch of rows (e.g., 1000 rows at a time).
- `query.data.done`: Indicates the query finished successfully.
- `error`: Standardized error reporting.
- `system.event`: Unsolicited events (e.g., connector restarted).

## Implementation Steps

1. **Websocket Server Integration:** Add a lightweight WebSockets library (e.g., `ws`) to the existing Node.js Daemon HTTP server.
2. **Protocol Definition:** Formalize the JSON schemas for all client and server events.
3. **Session Manager Update:** Bind the Websocket lifecycle (`on('close')`, `on('error')`) to the existing `SessionManager` so that disconnecting automatically cleans up temporary tables or running queries.
4. **Streaming Adaptor:** Pipe the `AsyncGenerator` output from the MCP Connectors (RFC-013) directly into Websocket `query.data.chunk` frames.

## Relationship to RFC-013 (MCP Connectors)

This RFC (RFC-014) handles the "Northbound" traffic: **Agent <-> Daemon**.
RFC-013 handles the "Southbound" traffic: **Daemon <-> Database Connectors**.

By implementing these in stages, we achieve a highly scalable, event-driven architecture. Agents talk to the Daemon instantly over Websockets, and the Daemon orchestrates out-of-process MCP Connectors to do the heavy lifting safely.

## Unresolved Questions

- Do we support binary websocket frames for dense analytical data (e.g., Apache Arrow format) to save JSON parsing overhead on massive exports?
- How do we handle backpressure if the Database Connector is streaming rows faster than the Agent's websocket connection can receive them?
