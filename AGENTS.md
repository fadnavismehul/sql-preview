# AGENTS.md

> **"A Map, Not a Manual"**
> This file is the high-level map of the SQL Preview repository. It serves as the entry point for AI agents to understand the project structure, architectural patterns, and where to find more detailed information.

## 🗺️ Repository Overview

**SQL Preview** is a VS Code extension for connecting to various databases (e.g., Trino, SQLite, DuckDB), executing queries, and visualizing results.

### Core Modules

- **[Server & Daemon](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/server/AGENTS.md)**: The backend process handling database connections and MCP server.
- **[UI & Webviews](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/ui/AGENTS.md)**: The frontend visualization layer (React + AG Grid).
- **[Connectors](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/connectors/AGENTS.md)**: Database driver implementations (Trino, Postgres, SQLite, DuckDB).

### Key Locations

- **[src/extension.ts](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/extension.ts)**: The main entry point for the VS Code extension.
- **[package.json](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/package.json)**: Definition of extension commands, configuration, and dependencies.

### Documentation Index

- **[README.md](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/README.md)**: User-facing documentation, features, and setup.
- **[CONTRIBUTING.md](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/CONTRIBUTING.md)**: Developer guide for setup, building, and submitting changes.
- **[docs/rfcs/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/docs/rfcs/README.md)**: Request for Comments (Architectural Decisions).

## 🏗️ Architecture Patterns

### Client-Server Model

The extension operates on a client-server architecture:

1.  **Extension Host (Client)**: Runs in the VS Code process. Handles UI, commands, and configuration.
2.  **Daemon (Server)**: A separate Node.js process spawned by the extension. It manages heavy lifting like maintaining DB connections and fetching results.
3.  **Communication**: The Client and Daemon communicate via **MCP (Model Context Protocol)** over stdio or HTTP.

### UI Architecture

- **Webviews**: The results grid is rendered in a webview using `AG Grid` for high-performance data display.
- **Message Passing**: The extension interacts with webviews via `postMessage`.

## 🛠️ Development Tools

| Task       | Command           | Description                                   |
| :--------- | :---------------- | :-------------------------------------------- |
| **Build**  | `npm run compile` | Compiles TypeScript to JavaScript.            |
| **Lint**   | `npm run lint`    | Runs ESLint to check for code quality issues. |
| **Test**   | `npm test`        | Runs the unit test suite.                     |
| **Format** | `npm run format`  | formats code using Prettier.                  |

## 🧪 Verification & Quality

Before submitting changes:

1.  Check the **[Changelog](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/Changelog.md)** entry requirement.
2.  Run `npm run lint` to ensure no style violations.
3.  Run `npm test` to verify no regressions.

---

_For more details, follow the links provided above. If a path is missing or incorrect, update this map._

<!-- desloppify-begin -->
<!-- desloppify-skill-version: 2 -->
---
name: desloppify
description: >
  Codebase health scanner and technical debt tracker. Use when the user asks
  about code quality, technical debt, dead code, large files, god classes,
  duplicate functions, code smells, naming issues, import cycles, or coupling
  problems. Also use when asked for a health score, what to fix next, or to
  create a cleanup plan. Supports 28 languages.
allowed-tools: Bash(desloppify *)
---

# Desloppify

## 1. Your Job

Improve code quality by maximising the **strict score** honestly.

**The main thing you do is run `desloppify next`** — it tells you exactly what to fix and how. Fix it, resolve it, run `next` again. Keep going.

Follow the scan output's **INSTRUCTIONS FOR AGENTS** — don't substitute your own analysis.

## 2. The Workflow

Two loops. The **outer loop** rescans periodically to measure progress.
The **inner loop** is where you spend most of your time: fixing issues one by one.

### Outer loop — scan and check

```bash
desloppify scan --path .       # analyse the codebase
desloppify status              # check scores — are we at target?
```
If not at target, work the inner loop. Rescan periodically — especially after clearing a cluster or batch of related fixes. Issues cascade-resolve and new ones may surface.

### Inner loop — fix issues

Repeat until the queue is clear:

```
1. desloppify next              ← tells you exactly what to fix next
2. Fix the issue in code
3. Resolve it (next shows you the exact command including required attestation)
```

Score may temporarily drop after fixes — cascade effects are normal, keep going.
If `next` suggests an auto-fixer, run `desloppify fix <fixer> --dry-run` to preview, then apply.

**To be strategic**, use `plan` to shape what `next` gives you:
```bash
desloppify plan                        # see the full ordered queue
desloppify plan move <pat> top         # reorder — what unblocks the most?
desloppify plan cluster create <name>  # group related issues to batch-fix
desloppify plan focus <cluster>        # scope next to one cluster
desloppify plan defer <pat>            # push low-value items aside
desloppify plan skip <pat>             # hide from next
desloppify plan done <pat>             # mark complete
desloppify plan reopen <pat>           # reopen
```

### Subjective reviews

The scan will prompt you when a subjective review is needed — just follow its instructions.
If you need to trigger one manually:
```bash
desloppify review --run-batches --runner codex --parallel --scan-after-import
```

### Other useful commands

```bash
desloppify next --count 5                         # top 5 priorities
desloppify next --cluster <name>                  # drill into a cluster
desloppify show <pattern>                         # filter by file/detector/ID
desloppify show --status open                     # all open findings
desloppify plan skip --permanent "<id>" --note "reason" # accept debt (lowers strict score)
desloppify scan --path . --reset-subjective       # reset subjective baseline to 0
```

## 3. Reference

### How scoring works

Overall score = **40% mechanical** + **60% subjective**.

- **Mechanical (40%)**: auto-detected issues — duplication, dead code, smells, unused imports, security. Fixed by changing code and rescanning.
- **Subjective (60%)**: design quality review — naming, error handling, abstractions, clarity. Starts at **0%** until reviewed. The scan will prompt you when a review is needed.
- **Strict score** is the north star: wontfix items count as open. The gap between overall and strict is your wontfix debt.
- **Score types**: overall (lenient), strict (wontfix counts), objective (mechanical only), verified (confirmed fixes only).

### Subjective reviews in detail

- **Preferred**: `desloppify review --run-batches --runner codex --parallel --scan-after-import` — does everything in one command.
- **Manual path**: `desloppify review --prepare` → review per dimension → `desloppify review --import file.json`.
- Import first, fix after — import creates tracked state entries for correlation.
- Integrity: reviewers score from evidence only. Scores hitting exact targets trigger auto-reset.
- Even moderate scores (60-80) dramatically improve overall health.
- Stale dimensions auto-surface in `next` — just follow the queue.

### Key concepts

- **Tiers**: T1 auto-fix → T2 quick manual → T3 judgment call → T4 major refactor.
- **Auto-clusters**: related findings are auto-grouped in `next`. Drill in with `next --cluster <name>`.
- **Zones**: production/script (scored), test/config/generated/vendor (not scored). Fix with `zone set`.
- **Wontfix cost**: widens the lenient↔strict gap. Challenge past decisions when the gap grows.
- Score can temporarily drop after fixes (cascade effects are normal).

## 4. Escalate Tool Issues Upstream

When desloppify itself appears wrong or inconsistent:

1. Capture a minimal repro (`command`, `path`, `expected`, `actual`).
2. Open a GitHub issue in `peteromallet/desloppify`.
3. If you can fix it safely, open a PR linked to that issue.
4. If unsure whether it is tool bug vs user workflow, issue first, PR second.

## Prerequisite

`command -v desloppify >/dev/null 2>&1 && echo "desloppify: installed" || echo "NOT INSTALLED — run: pip install --upgrade git+https://github.com/peteromallet/desloppify.git"`

<!-- desloppify-end -->

## Gemini CLI Overlay

Gemini CLI has experimental subagent support, but subagents currently run
sequentially (not in parallel). Review dimensions one at a time.

### Setup

Enable subagents in Gemini CLI settings:
```json
{
  "experimental": {
    "enableAgents": true
  }
}
```

Optionally define a reviewer agent in `.gemini/agents/desloppify-reviewer.md`:

```yaml
---
name: desloppify-reviewer
description: Scores subjective codebase quality dimensions for desloppify
kind: local
tools:
  - read_file
  - search_code
temperature: 0.2
max_turns: 10
---

You are a code quality reviewer. You will be given a codebase path, a set of
dimensions to score, and what each dimension means. Read the code, score each
dimension 0-100 from evidence only, and return JSON in the required format.
Do not anchor to target thresholds. When evidence is mixed, score lower and
explain uncertainty.
```

### Review workflow

1. Preferred local path (Codex runner): `desloppify review --run-batches --runner codex --parallel --scan-after-import`.
2. Gemini/cloud path: run `desloppify review --prepare` to generate `query.json`.
3. Invoke the reviewer agent for each group of dimensions sequentially.
   Even without parallelism, isolating dimensions across separate agent
   invocations prevents score bleed between concerns.
4. Merge assessments and findings, then import:
   - robust session flow (recommended): `desloppify review --external-start --external-runner claude`; use generated `claude_launch_prompt.md` + `review_result.template.json`, then run printed `desloppify review --external-submit --session-id <id> --import <file>`
   - durable scored import (legacy): `desloppify review --import findings.json --attested-external --attest "I validated this review was completed without awareness of overall score and is unbiased."`
   - findings-only fallback: `desloppify review --import findings.json`

When Gemini CLI adds parallel subagent execution, split dimensions across
concurrent agent calls instead.

### Review integrity

1. Do not use prior chat context, score history, or target-threshold anchoring while scoring.
2. Score from evidence only; when evidence is mixed, score lower and explain uncertainty.
3. Return machine-readable JSON only for review imports. For `--external-submit`, include `session` from the generated template:

```json
{
  "session": {
    "id": "<session_id_from_template>",
    "token": "<session_token_from_template>"
  },
  "assessments": {
    "naming_quality": 0,
    "error_consistency": 0,
    "abstraction_fit": 0,
    "logic_clarity": 0,
    "ai_generated_debt": 0
  },
  "findings": [
    {
      "dimension": "naming_quality",
      "identifier": "short_id",
      "summary": "one-line defect summary",
      "related_files": ["relative/path/to/file.py"],
      "evidence": ["specific code observation"],
      "suggestion": "concrete fix recommendation",
      "confidence": "high|medium|low"
    }
  ]
}
```
4. `findings` MUST match `query.system_prompt` exactly. Use `"findings": []` only when no defects are found.
5. Import is fail-closed by default: invalid/skipped findings abort `desloppify review --import` unless `--allow-partial` is explicitly passed.
6. Assessment scores are auto-applied from trusted internal run-batches imports, or via Claude cloud session imports (`--external-start` + printed `--external-submit`). Legacy attested external import via `--attested-external` remains supported.

<!-- desloppify-overlay: gemini -->
<!-- desloppify-end -->
