# RFC Index and Process

**Status:** Implemented  
**Created:** 2026-02-16  
**Owner:** Core Team

## Purpose

This folder stores Request for Comments (RFCs) for non-trivial changes in `project-preview`.
RFCs are lightweight, agent-legible specs that explain what we are changing, why it matters, and how success is verified.

## Lifecycle

- **Proposed**: draft or under review, located in `docs/rfcs/proposed/`
- **Implemented**: shipped, located in `docs/rfcs/done/`
- **Parked**: deferred, located in `docs/rfcs/parked/`
- **Superseded**: replaced by a newer RFC (usually moved to `docs/rfcs/superseded/`)

## When RFC is Required

RFC is required for non-trivial changes, including:

- New feature or major workflow change
- New integration or external dependency pattern
- Refactor spanning multiple modules or layers
- Behavior changes that require migration, rollout, or explicit acceptance criteria

RFC is optional for small bug fixes, typo/docs-only changes, and narrowly scoped maintenance updates.

## Numbering and Naming

- Filename format: `RFC-XXX-short-kebab-title.md`
- `XXX` is zero-padded (`001`, `002`, ...)
- Keep one RFC per decision scope
- Use `RFC-000-template.md` as the starting scaffold for new RFCs

## Required RFC Metadata

Every RFC must include:

- `Status`
- `Created`
- `Owner`

## RFC Registry

| RFC     | Status      | Location                                               | Summary                         |
| ------- | ----------- | ------------------------------------------------------ | ------------------------------- |
| RFC-000 | Proposed    | `docs/rfcs/proposed/RFC-000-roadmap.md`                | Roadmap                         |
| RFC-001 | Proposed    | `docs/rfcs/proposed/RFC-001-agentic-testing.md`        | Agentic Testing Principles      |
| RFC-002 | Parked      | `docs/rfcs/parked/RFC-002-standalone-browser-ui.md`    | Standalone Browser UI           |
| RFC-003 | Implemented | `docs/rfcs/done/RFC-003-single-server-architecture.md` | Single Server Architecture      |
| RFC-004 | Proposed    | `docs/rfcs/proposed/RFC-004-mcp-apps-ui.md`            | MCP Apps UI                     |
| RFC-005 | Proposed    | `docs/rfcs/proposed/RFC-005-mcp-session-security.md`   | MCP Session Security            |
| RFC-006 | Implemented | `docs/rfcs/done/RFC-006-mcp-data-handling.md`          | MCP Data Handling               |
| RFC-007 | Implemented | `docs/rfcs/done/RFC-007-multi-session-http.md`         | Multi-Session HTTP Architecture |
| RFC-008 | Proposed    | `docs/rfcs/proposed/RFC-008-sqlite-support.md`         | SQLite Support                  |
