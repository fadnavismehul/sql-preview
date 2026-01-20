# RFC-001: Agentic Testing Strategy

**Status**: Proposed
**Created**: 2026-01-20

## Goal

Leverage AI Agents to implement novel testing methodologies for `sql-preview` that go beyond traditional unit and integration tests.

## 1. Semantic Fuzzing via MCP

Since `sql-preview` now exposes an **MCP (Model Context Protocol) Server**, we can treat the extension as a "tool" accessible to an LLM.

- **Concept**: An "Attacker Agent" uses the `run_query` tool to execute diverse, complex, and edge-case SQL queries against the extension.
- **Workflow**:
  1.  Agent connects to the MCP Server.
  2.  Agent generates 50+ variations of SQL (valid, invalid, massive integers, special characters, nested JSON).
  3.  Agent executes them via `run_query`.
  4.  Agent analyzes the JSON response:
      - Did the extension crash? (Connection drop)
      - Did it return a clean error message vs. a stack trace?
      - Is the data format correct (e.g., BigInt handling)?
- **Why Novel?**: It dynamically tests the "connectors -> execution -> serialization" pipeline with inputs no human would manually write (e.g., emojis in column aliases, recursive CTEs).

## 2. Docs-Driven Test Generation

- **Concept**: An "QA Agent" reads the repository's documentation to generate test cases.
- **Workflow**:
  1.  Agent reads `CHANGELOG.md` and files in `docs/implementations/`.
  2.  Agent identifies new features (e.g., "Row Height Persistence").
  3.  Agent generates a new `*.test.ts` file using the `vscode-test` framework to verify this specific behavior.
- **Why Novel?**: Keeps test coverage synchronized with documentation automatically.

## 3. Visual "Look & Feel" Heuristics

- **Concept**: An Agent evaluates the _aesthetics_ of the grid, not just the DOM structure.
- **Workflow**:
  1.  Run the extension in a headless environment with screenshot capabilities.
  2.  Capture images of the Results Grid under different themes (Dark/Light).
  3.  Pass images to a Vision-enabled Agent.
  4.  Prompt: "Does this look broken? Are headers aligned? Is the contrast sufficient?"
- **Why Novel?**: Catches visual regression (e.g., "ugly blue box" focus ring) that functional tests miss.

## 4. Agent-Driven UI Automation (The "Ghost in the Machine")

- **Concept**: An Agent uses **Selenium WebDriver** (via `vscode-extension-tester`) to physically launch VS Code, click buttons, type text, and interact with Webviews, mimicking a human user.
- **Workflow**:
  1.  **Launch**: The test harness launches a real VS Code instance with the extension installed.
  2.  **Interact**: The script (generated or controlled by an Agent) uses Page Object Models (POMs) to:
      - Open the Command Palette (`F1`).
      - Type "Run Query".
      - Click the "Run" code lens.
      - **Switch Context**: Jump into the `<iframe>` of the Webview to verify AG Grid rows exist.
  3.  **Observe**: Capture DOM state or screenshots on failure.
- **Why Novel?**: Most VS Code tests are API-only (`vscode-test`). This approach tests the _integration_ of the VS Code shell, the Webview, and the Extension Host process. An LLM can write these complex Selenium scripts by reading the `package.json` command list and the DOM structure of the webview.

## Recommendation

Start with **Strategy 1 (MCP Fuzzing)** for backend robustness, then move to **Strategy 4 (UI Automation)** for end-to-end verification.

1.  We just stabilized the MCP server.
2.  It tests the core value proposition (running queries).
3.  It requires no new infrastructure, just a script to drive the MCP client.
