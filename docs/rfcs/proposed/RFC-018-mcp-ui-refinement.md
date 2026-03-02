# RFC-018: MCP App UI Refinement

**Status:** Proposed  
**Created:** 2026-03-02  
**Owner:** Core Team  
**Related RFCs:** RFC-004 (MCP Apps UI — original design), RFC-016 (Schema Metadata API)

## Goal

Bring the MCP App UI (`src/mcp-app/`) to a production-presentable state so that the first interaction a user has via Claude Desktop, Cursor, or Claude Web demonstrates a premium product, not an internal prototype.

## Problem Statement

RFC-004 was marked "Implemented" and the core plumbing is correct (Vite single-file build, AG Grid, `@modelcontextprotocol/ext-apps` `App` class). However, the current implementation stops short of the UX described in the RFC's design:

- **No CSS** — all layout is done with raw inline `style={}` props. The app looks like an unstyled HTML form.
- **No toolbar** — the Re-run, Export CSV, Copy to Clipboard actions described in RFC-004 Phase 2 are not built.
- **No empty state** — a bare `<textarea>` appears before any query is run. There is no prompt or guidance.
- **Error display** swaps the entire app view with a red `<div>`, losing context.
- **Connections tab is read-only** — users can list and test connections but cannot add, edit, or delete profiles from within the Claude Desktop MCP app. This is a dealbreaker for headless setups where VS Code is not running.
- The `"MCP Integration (Beta)"` label in README correctly signals immaturity; this RFC removes that qualifier.

## Scope

**In Scope:**

- CSS design system in `src/mcp-app/styles/theme.css` — complete replacement of inline styles
- Toolbar component: Re-run, Export CSV, Copy to clipboard
- Empty state with instructional content
- Inline error display (toast / notification area, not full-screen swap)
- Query info strip: row count, execution time, connection name, collapsible SQL preview
- Connections CRUD UI: create, edit, delete profiles via the `add_connection`, `update_connection`, `delete_connection` MCP tools (see implementation note below)
- Loading skeleton/spinner for the grid during query execution

**Out of Scope:**

- Schema browser / tree view (deferred to RFC-016 + a follow-up MCP App enhancement)
- Query history persistence (depends on stateful host context, future work)
- Fullscreen mode (`app.requestDisplayMode`)
- Pagination UI for >1000-row result sets

## Proposal

### 1. CSS Design System (`theme.css`)

Replace all inline `style={}` with CSS classes. The stylesheet must:

- Use CSS custom properties (`--color-*`, `--spacing-*`) to inherit from the VS Code / Claude host theme context
- Follow the `ag-theme-alpine` / `ag-theme-alpine-dark` pattern for grid theme switching
- Provide a complete component vocabulary: `.toolbar`, `.btn`, `.btn-primary`, `.status-bar`, `.empty-state`, `.error-toast`, `.query-preview`, `.connections-table`

```css
/* Example tokens */
:root {
  --color-bg: #ffffff;
  --color-surface: #f3f4f6;
  --color-border: #e5e7eb;
  --color-text: #111827;
  --color-text-muted: #6b7280;
  --color-accent: #2563eb;
  --color-error: #dc2626;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --radius: 6px;
}

.dark-theme {
  --color-bg: #1e1e2e;
  --color-surface: #2a2a3e;
  --color-border: #3d3d5c;
  --color-text: #e2e8f0;
  --color-text-muted: #94a3b8;
  --color-accent: #60a5fa;
}
```

### 2. Component Breakdown

#### `Toolbar.tsx` (new)

```typescript
interface ToolbarProps {
  rowCount: number;
  executionTime: number;
  connectionName: string;
  query: string;
  onRerun: () => void;
  onExportCsv: () => void;
  onCopy: () => void;
  isLoading: boolean;
}
```

Actions:

- **Re-run**: calls `app.callServerTool({ name: 'run_query', arguments: { sql, connection } })`
- **Export CSV**: generates a Blob and triggers download. Since MCP App iframes cannot initiate `<a>` downloads directly, use `app.openLink({ url: blobUrl })` or copy to clipboard as TSV fallback.
- **Copy**: copies selected cells or all rows as TSV via `navigator.clipboard.writeText`

#### `StatusBar.tsx` (new)

Single-line strip below toolbar: `142 rows · 312ms · via production-db`

#### `EmptyState.tsx` (new)

Shown before first result. Content:

```
[SQL Preview icon]
Ask Claude to query your database.
Try: "Show me the top 10 customers by revenue"
```

#### `ErrorToast.tsx` (new)

Inline dismissable notification. Does NOT replace the app view. Appears above the grid.

#### `QueryPreview.tsx` (new)

Collapsible panel showing the SQL that produced the current results. `<details><summary>SQL</summary><code>...</code></details>` pattern.

### 3. Connections CRUD

The Daemon MCP tool set needs three new tools to support this (coordinate with RFC-016 team):

| Tool                | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `add_connection`    | Creates a new profile in `FileProfileStore` |
| `update_connection` | Patches an existing profile                 |
| `remove_connection` | Deletes a profile by ID                     |

The Connections tab in the MCP app renders a form that calls these tools via `app.callServerTool`. Since the MCP App cannot perform async I/O itself, all persistence is handled by the Daemon.

Connection form fields vary by connector type. The form renders a type selector first, then shows connector-specific fields. Initial v1 supports: `trino`, `postgres`, `sqlite`, `duckdb`, `mysql`, `mssql`, `snowflake`, `bigquery` (the P0 connector set).

### 4. Grid Empty / Loading States

- **Loading**: Show an `<AgGridReact>` skeleton (the grid itself with no data and a `loadingOverlayComponent`)
- **No results**: AG Grid built-in no-rows overlay: "Query returned 0 rows"

## Implementation Plan

1. **CSS** — Replace `theme.css` with the full design token system. Audit every JSX file in `src/mcp-app/` and replace inline styles with class names.
2. **EmptyState + ErrorToast** — New components, wire into `App.tsx`.
3. **Toolbar + StatusBar + QueryPreview** — New components, render in order below the nav bar when `result` is set.
4. **Connections CRUD tools** — Add `add_connection`, `update_connection`, `remove_connection` to `DaemonMcpToolManager`. Delegate to `ConnectionManager`.
5. **Connections form** — Build connector-aware form in `ConnectionsManager.tsx`.
6. **Build verification** — `npm run build:mcp-app` must produce a single `dist/mcp-app.html` ≤ 3MB (uncompressed).
7. **Manual test** — Load in `basic-host` from `@modelcontextprotocol/ext-apps` examples; verify dark/light theme toggle, re-run, export.

## Acceptance Criteria

1. `npm run build:mcp-app` succeeds and `dist/mcp-app.html` loads in a sandboxed iframe without errors.
2. Running a query shows: toolbar (Re-run, Export CSV, Copy), status bar (row count + time + connection), collapsible SQL preview, and the AG Grid.
3. Empty state shown before first query — not a raw textarea.
4. Error from a bad query shows a dismissable toast, not a page swap.
5. Connections tab: user can add a new Postgres profile, test it, update the host, and delete it — all without leaving Claude Desktop.
6. Dark theme renders correctly (dark background, light text, correct AG Grid theme).
7. The README no longer says "Beta" for MCP Integration.

## Risks and Mitigations

| Risk                                                                    | Likelihood | Mitigation                                                          |
| ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------- |
| `app.openLink` not available in all hosts for CSV download              | Medium     | Fallback to `navigator.clipboard.writeText` with TSV format         |
| iframe CSP blocks blob URLs                                             | Medium     | Test with real Claude Desktop; fallback to copy-to-clipboard export |
| Connections CRUD requires Daemon changes, creates cross-team dependency | Low        | Can ship read-only Connections tab v1, CRUD as fast-follow          |

## Rollout and Backout

**Rollout:** The MCP App is rebuilt as a single-file bundle. The Daemon serves it from `dist/mcp-app.html`. No changes to the SSE or stdio transport paths; fully additive.

**Backout:** Revert to the previous `dist/mcp-app.html`. The rest of the Daemon is unaffected.

## Open Questions

1. Should the Connection form support the `custom` profile type (RFC-012 Option 2)? This allows pointing at any community connector package. Decision: out of scope for P0, add in P1.
2. Should "Export CSV" use `app.openLink` with a blank-target approach, or always copy to clipboard? Depends on host behavior — test and decide during implementation.
