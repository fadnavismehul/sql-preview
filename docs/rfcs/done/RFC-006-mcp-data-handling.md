# RFC-006: MCP Smart Summary Data Handling

**Status**: Implemented
**Created**: 2026-02-05

## 1. Problem Statement

When the MCP server returns large datasets (standard `run_query` or `get_tab_info` results), it overwhelms the LLM's context window.

- **Context Flooding**: Returning thousands of rows consumes tokens and degrades reasoning.
- **Client Mitigation**: Clients like Cursor automatically intercept large outputs and write them to files to protect the context window. This confuses the agent, which expects to see data.
- **Goal**: Facilitate "database-side compute" by encouraging the LLM to refine queries based on metadata, rather than dumping all rows into the context for "in-context compute".

## 2. Proposed Solution: "Smart Summary" Pattern

We introduce a "Preview-First" strategy for the `get_tab_info` tool.

### A. The `ResultSummary` Response Structure

Instead of returning a flat list of rows, the tool will return a structured summary object by default.

```typescript
interface ResultSummary {
  status: 'success' | 'error';
  meta: {
    totalRows: number;
    columns: ColumnDef[];
    executionTime?: number;
  };
  preview: Row[]; // Small heuristic sample (e.g., first 5-10 rows)
  message: string; // Guidance for the LLM
  resourceUri: string; // Link to the full resource
}
```

### B. Tool Interface Changes (`get_tab_info`)

New optional argument: `mode`.

| Mode      | Description                                                          | Payload                      |
| :-------- | :------------------------------------------------------------------- | :--------------------------- |
| `preview` | **(Default)** Returns metadata, schema, and a small preview of rows. | `ResultSummary`              |
| `page`    | Returns specific rows for iteration/pagination.                      | `{ rows: [...], meta: ... }` |

### C. Workflow

1.  **Agent runs query**: `run_query("SELECT * FROM large_table")`
2.  **Server**: Returns `tabId`.
3.  **Agent checks results**: `get_tab_info(tabId)` (Default mode)
4.  **Server**: Returns `ResultSummary`:
    - `meta.totalRows`: 15,000
    - `preview`: [Rows 1-5]
    - `message`: "Showing 5 of 15,000 rows. Use SQL to filter or mode='page' to view more."
5.  **Agent Decision**:
    - _Path A (Analysis)_: "Oh, it's huge. I'll run `SELECT count(*) ...` instead." (Success: Compute pushed to DB)
    - _Path B (Inspection)_: "I need to see the next 50 rows." calls `get_tab_info(mode='page', limit=50, offset=5)`
    - _Path C (Export)_: "I need full access." calls `read_resource(resourceUri)`

## 3. Implementation Details

- **`DaemonMcpToolManager`**:
  - Update `get_tab_info` input schema.
  - Implement the `mode` switching logic.
- **Resources**:
  - Ensure `resourceUri` is constructed correctly (`sql-preview://sessions/${sid}/tabs/${tid}`).
  - Existing `read_resource` implementation handles full data retrieval and is sufficient.

## 4. Future Considerations

- **Statistical Summaries**: In the future, `meta` could include min/max/null counts for columns to further aid the LLM without viewing rows.
- **MCP Apps**: The `resourceUri` will eventually support `ui://` schemes for interactive rich previews (see RFC-004).
