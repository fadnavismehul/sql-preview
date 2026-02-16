# UI & Webview Architecture

> **Context**: This module handles the visualization of query results. It runs inside a VS Code Webview, isolated from the main extension process.

## 🗺️ Map

- **[webviews/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/ui/webviews/)**: Root for webview implementations.
  - **[results/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/ui/webviews/results/)**: The main results grid view.
- **[common/](file:///Users/mehul.fadnavis/Desktop/Work/Code/project-preview/src/ui/common/)**: Shared UI utilities and types.

## 🏗️ Tech Stack

- **React**: Used for component structure and state management.
- **AG Grid**: The core component for rendering high-performance data tables.
- **VS Code Webview API**: Used for `postMessage` communication with the extension host.

## 🔄 Message Protocol

Communication between the Extension Host (`ResultsViewProvider`) and the Webview (`index.tsx`) happens via `postMessage`.

### From Extension -> Webview

- `update`: Payload containing the data rows and columns to display.
- `setLoading`: Boolean to toggle the loading spinner.
- `setError`: Error message string to display.

### From Webview -> Extension

- `ready`: Sent when the webview component mounts.
- `copy`: Request to copy data to clipboard (handled by extension for full access).
- `save`: Request to save/export data.

## 🎨 Styling

- Use **CSS Variables** provided by VS Code (e.g., `--vscode-editor-background`) to ensure theming consistency.
- **Avoid** hardcoded colors.
