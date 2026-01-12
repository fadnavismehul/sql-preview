import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { QueryExecutor } from './services/QueryExecutor';
import { TabData, ExtensionToWebviewMessage, QueryResults } from './common/types';
import { StateManager } from './services/StateManager';
import { getNonce } from './utils/nonce';

/**
 * Manages the webview panel for displaying query results.
 * It handles:
 * - Creating and initializing the webview HTML.
 * - Receiving messages from the extension (e.g., query results, errors).
 * - Sending messages from the webview back to the extension.
 */
export class ResultsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sqlResultsView';

  private _view?: vscode.WebviewView | undefined;
  private _outputChannel: vscode.OutputChannel;
  // Store tab data in memory for MCP access
  private _tabData: Map<string, TabData> = new Map();
  private _activeTabId: string | undefined;
  private _resultCounter = 1;
  private _activeEditorUri: string | undefined;
  private _stateManager: StateManager;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    private readonly _queryExecutor: QueryExecutor
  ) {
    this._outputChannel = vscode.window.createOutputChannel('SQL Preview');
    this._stateManager = new StateManager(context);

    // Load state
    this._loadState();

    // Listen for active editor changes
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document && editor.document.languageId === 'sql') {
          this._activeEditorUri = editor.document.uri.toString();
          this._filterTabsByFile(this._activeEditorUri);
        } else {
          // If switching to non-SQL file or no editor, allow view to decide behavior
          // Current behavior: show all if undefined.
          // TODO: Refine this for production to potentially hide tabs or show "No SQL file active"
          this._activeEditorUri = undefined;
          this._filterTabsByFile(undefined);
        }
      })
    );
  }

  public dispose() {
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }

  /**
   * Logs a message to the output channel.
   */
  public log(message: string) {
    this._outputChannel.appendLine(message);
  }

  /**
   * Called when the view is resolved (i.e., created or shown).
   * Sets up the webview's initial HTML content and message handling.
   */
  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    // Validate extension URI
    if (!this._extensionUri?.fsPath) {
      this.log('ERROR: Invalid extension URI');
      return;
    }

    const resourceRoots = [
      vscode.Uri.joinPath(this._extensionUri, 'media'),
      vscode.Uri.joinPath(this._extensionUri, 'webviews'),
    ];

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: resourceRoots,
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Listen for configuration changes
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('sqlPreview.fontSize')) {
        const config = vscode.workspace.getConfiguration('sqlPreview');
        const customFontSize = config.get<number>('fontSize', 0);
        const fontSizeValue =
          customFontSize > 0
            ? `${customFontSize}px`
            : `var(--vscode-editor-font-size, var(--vscode-font-size))`;

        this._postMessage({ type: 'updateFontSize', fontSize: fontSizeValue });
      }
    });

    webviewView.onDidDispose(() => {
      configListener.dispose();
      this._view = undefined;
    });

    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.command) {
        case 'alert':
          vscode.window.showInformationMessage(data.text);
          return;
        case 'createNewTab':
          // Requesting new tab execution is handled by command palette usually,
          // but we can trigger the command.
          vscode.commands.executeCommand('sql.runQueryNewTab');
          return;
        case 'webviewLoaded':
          this._restoreTabsToWebview();
          if (this._activeEditorUri) {
            this._filterTabsByFile(this._activeEditorUri);
          }
          return;
        case 'tabClosed':
          this.log(`Tab closed: ${data.tabId}`);
          this._tabData.delete(data.tabId);
          if (this._activeTabId === data.tabId) {
            this._activeTabId = undefined;
          }
          this._saveState();
          return;
        case 'updateTabState': {
          const tab = this._tabData.get(data.tabId);
          if (tab) {
            if (data.title) {
              tab.title = data.title;
            }
            if (data.query) {
              tab.query = data.query;
            }
            this._saveState();
          }
          return;
        }
        case 'tabSelected':
          this._activeTabId = data.tabId;
          this._saveState();
          return;
        case 'exportResults':
          this._handleExportResults(data.tabId);
          return;
      }
    });
  }

  private _postMessage(message: ExtensionToWebviewMessage) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  // --- Public methods ---

  public showLoadingForTab(tabId: string, query: string, title: string) {
    this.log(`showLoadingForTab: ${tabId}`);

    // Update state
    const existing = this._tabData.get(tabId);
    if (existing) {
      existing.status = 'loading';
      existing.query = query;
      existing.title = title;
    }
    this._saveState();

    this._ensureVisible();
    this._postMessage({ type: 'showLoading', tabId, query, title });
  }

  public showResultsForTab(tabId: string, resultData: QueryResults) {
    this.log(`showResultsForTab: ${tabId}`);

    const existing = this._tabData.get(tabId);
    const newData: TabData = {
      id: tabId,
      title: existing?.title || 'Query Results',
      query: resultData.query,
      columns: resultData.columns,
      rows: resultData.rows,
      status: 'success',
      wasTruncated: resultData.wasTruncated,
      totalRowsInFirstBatch: resultData.totalRowsInFirstBatch,
      queryId: resultData.queryId,
      infoUri: resultData.infoUri,
      nextUri: resultData.nextUri,
      sourceFileUri: existing?.sourceFileUri,
    };

    this._tabData.set(tabId, newData);
    this._activeTabId = tabId;
    this._saveState();

    this._ensureVisible();
    this._postMessage({
      type: 'resultData',
      tabId,
      data: resultData,
      title: newData.title,
    });
  }

  public showErrorForTab(
    tabId: string,
    message: string,
    details?: string,
    query?: string,
    title?: string
  ) {
    this.log(`showErrorForTab: ${tabId}`);

    const existing = this._tabData.get(tabId);
    const newData: TabData = {
      id: tabId,
      title: title || existing?.title || 'Error',
      query: query || existing?.query || '',
      columns: existing?.columns || [],
      rows: existing?.rows || [],
      status: 'error',
      error: message,
      errorDetails: details,
      sourceFileUri: existing?.sourceFileUri,
    };

    this._tabData.set(tabId, newData);
    this._saveState();

    this._ensureVisible();
    this._postMessage({
      type: 'queryError',
      tabId,
      error: { message, details },
      query,
      title,
    });
  }

  public showStatusMessage(message: string) {
    this._ensureVisible();
    this._postMessage({ type: 'statusMessage', message });
  }

  public createTabWithId(tabId: string, query: string, title: string, sourceFileUri?: string) {
    this.log(`createTabWithId: ${tabId}`);

    this._tabData.set(tabId, {
      id: tabId,
      title,
      query,
      columns: [],
      rows: [],
      status: 'created',
      sourceFileUri,
    });
    this._activeTabId = tabId;
    this._saveState();

    this._ensureVisible();
    this._postMessage({ type: 'createTab', tabId, query, title, sourceFileUri });
  }

  public getOrCreateActiveTabId(query: string, title?: string, sourceFileUri?: string): string {
    if (this._activeTabId && this._tabData.has(this._activeTabId)) {
      const tabId = this._activeTabId;
      const existing = this._tabData.get(tabId);

      // Validation: Ensure we don't reuse a tab from a different file
      if (existing && (!sourceFileUri || existing.sourceFileUri === sourceFileUri)) {
        existing.query = query;
        if (title) {
          existing.title = title;
        }
        // sourceFileUri match is already confirmed or ignored

        this._saveState();

        this._ensureVisible();
        this._postMessage({
          type: 'reuseOrCreateActiveTab',
          tabId,
          query,
          title: title || existing.title,
          sourceFileUri,
        });
        return tabId;
      }
      // If mismatch, fall through to create new tab
    }

    const newTabId = `tab-${Date.now()}`;
    this.createTabWithId(newTabId, query, title || 'Result', sourceFileUri);
    return newTabId;
  }

  // --- Convenience methods for backward compatibility or single-tab usage ---

  public showLoading() {
    if (this._activeTabId) {
      const tab = this._tabData.get(this._activeTabId);
      if (tab) {
        this.showLoadingForTab(this._activeTabId, tab.query, tab.title);
      }
    }
  }

  public showResults(data: any) {
    // Compatibility wrapper for tests
    // Need to map 'any' to QueryResults strictly
    if (this._activeTabId) {
      const strictData: QueryResults = {
        columns: data.columns,
        rows: data.rows,
        query: data.query,
        wasTruncated: data.wasTruncated || false,
        totalRowsInFirstBatch: data.totalRowsInFirstBatch || data.rows.length,
        queryId: data.queryId,
        infoUri: data.infoUri,
        nextUri: data.nextUri,
      };
      this.showResultsForTab(this._activeTabId, strictData);
    }
  }

  public showError(message: string, details?: string) {
    if (this._activeTabId) {
      this.showErrorForTab(this._activeTabId, message, details);
    }
  }

  /** Creates a new tab (convenience wrapper) - Generates ID automatically */
  public createTab(query: string, title?: string) {
    const tabId = `tab-${Date.now()}`;
    this.createTabWithId(tabId, query, title || 'Query Result');
  }

  // --- Public methods for MCP Server ---

  public getTabs(): TabData[] {
    return Array.from(this._tabData.values());
  }

  public getTabData(tabId: string): TabData | undefined {
    return this._tabData.get(tabId);
  }

  public getActiveTabId(): string | undefined {
    return this._activeTabId;
  }

  public get activeEditorUri(): string | undefined {
    return this._activeEditorUri;
  }

  public getMaxResultCountForFile(fileUri: string | undefined): number {
    if (!fileUri) {
      return 0;
    }
    let maxCount = 0;
    this._tabData.forEach(tab => {
      if (tab.sourceFileUri === fileUri) {
        const match = tab.title.match(/^Result (\d+)$/);
        if (match && match[1]) {
          const count = parseInt(match[1], 10);
          if (count > maxCount) {
            maxCount = count;
          }
        }
      }
    });
    return maxCount;
  }

  public closeActiveTab() {
    if (this._activeTabId) {
      this.closeTab(this._activeTabId);
    }
  }

  public closeTab(tabId: string) {
    if (this._tabData.has(tabId)) {
      this._tabData.delete(tabId);
      this._postMessage({ type: 'closeTab', tabId });
      if (this._activeTabId === tabId) {
        this._activeTabId = undefined;
      }
      this._saveState();
    }
  }

  public closeOtherTabs() {
    if (this._activeTabId) {
      const active = this._tabData.get(this._activeTabId);
      this._tabData.clear();
      if (active) {
        this._tabData.set(this._activeTabId, active);
      }
      this._postMessage({ type: 'closeOtherTabs' });
      this._saveState();
    }
  }

  public closeAllTabs() {
    this._tabData.clear();
    this._activeTabId = undefined;
    this._postMessage({ type: 'closeAllTabs' });
    this._saveState();
  }

  public async exportFullResults() {
    if (this._activeTabId) {
      await this._handleExportResults(this._activeTabId);
    } else {
      vscode.window.showErrorMessage('No active tab to export.');
    }
  }

  // --- Private ---

  private _ensureVisible() {
    if (this._view) {
      this._view.show?.(true);
    }
  }

  private async _saveState() {
    await this._stateManager.saveState(this._tabData, this._resultCounter);
  }

  private async _loadState() {
    const state = await this._stateManager.loadState();
    if (state) {
      this._tabData = state.tabs;
      this._resultCounter = state.resultCounter;
      this.log(`State loaded. Tabs: ${this._tabData.size}`);
    }
  }

  private _restoreTabsToWebview() {
    this._tabData.forEach(tab => {
      this._postMessage({
        type: 'createTab',
        tabId: tab.id,
        query: tab.query,
        title: tab.title,
        sourceFileUri: tab.sourceFileUri,
      });

      if (tab.status === 'success' && tab.rows.length > 0) {
        const queryResults: QueryResults = {
          columns: tab.columns,
          rows: tab.rows,
          query: tab.query,
          wasTruncated: tab.wasTruncated || false,
          totalRowsInFirstBatch: tab.totalRowsInFirstBatch || tab.rows.length,
          queryId: tab.queryId,
          infoUri: tab.infoUri,
          nextUri: tab.nextUri,
        };
        this._postMessage({
          type: 'resultData',
          tabId: tab.id,
          data: queryResults,
          title: tab.title,
        });
      } else if (tab.status === 'error') {
        this._postMessage({
          type: 'queryError',
          tabId: tab.id,
          error: { message: tab.error || 'Unknown', details: tab.errorDetails },
          title: tab.title,
        });
      } else if (tab.status === 'created') {
        // Just created, nothing else to send
      } else if (tab.status === 'loading') {
        this._postMessage({ type: 'showLoading', tabId: tab.id, title: tab.title });
      }
    });
  }

  private _filterTabsByFile(fileUri: string | undefined) {
    if (!fileUri) {
      // Persistence: Do not clear view if user switches to non-SQL file.
      // Keep showing the last active state.
      return;
    }

    // Logic: If we switch files, we must ensure the _activeTabId belongs to the visible set per fileUri.
    // If it doesn't, we must determine a new active tab or plain clear it.

    // 1. Determine which tabs are visible for this fileUri
    const visibleTabs: TabData[] = [];
    this._tabData.forEach(tab => {
      // If fileUri is undefined/null, we decided to HIDE ALL (strict mode for clearing view).
      // If fileUri is set, show matching tabs.
      // wait, if fileUri is undefined, we want to hide everything. matches should be empty.

      if (fileUri) {
        if (tab.sourceFileUri === fileUri) {
          visibleTabs.push(tab);
        }
      }
    });

    // 2. Check if current active tab is in the visible set
    let activeTabIsValid = false;
    if (this._activeTabId) {
      const activeTab = this._tabData.get(this._activeTabId);
      if (activeTab && fileUri && activeTab.sourceFileUri === fileUri) {
        activeTabIsValid = true;
      }
    }

    // 3. Update Active Tab ID if needed
    if (!activeTabIsValid) {
      if (visibleTabs.length > 0) {
        // Pick the last created one
        const lastTab = visibleTabs[visibleTabs.length - 1];
        if (lastTab) {
          this._activeTabId = lastTab.id;
        }
      } else {
        // No visible tabs for this file (or cleared view)
        this._activeTabId = undefined;
      }
    }

    if (this._view) {
      // Extract filename for display
      const fileName = fileUri ? fileUri.split('/').pop() : undefined;
      this._view.webview.postMessage({ type: 'filterTabs', fileUri, fileName } as any);
    }
  }

  private async _handleExportResults(tabId: string) {
    const tab = this._tabData.get(tabId);
    if (!tab) {
      vscode.window.showErrorMessage('Tab not found for export.');
      return;
    }

    const saveUri = await vscode.window.showSaveDialog({
      filters: {
        'CSV (Comma Separated)': ['csv'],
        'TSV (Tab Separated)': ['tsv'],
        JSON: ['json'],
      },
      title: 'Export Full Results',
      defaultUri: vscode.Uri.file(
        path.join(
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
          `${tab.title.replace(/\s+/g, '_')}.csv`
        )
      ),
    });

    if (!saveUri) {
      return;
    }

    const format = saveUri.fsPath.endsWith('.tsv')
      ? 'tsv'
      : saveUri.fsPath.endsWith('.json')
        ? 'json'
        : 'csv';

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Exporting results to ${path.basename(saveUri.fsPath)}`,
        cancellable: true,
      },
      async (progress, token) => {
        const stream = fs.createWriteStream(saveUri.fsPath);
        let rowCount = 0;

        try {
          const generator = this._queryExecutor.execute(tab.query);
          let firstPage = true;

          if (format === 'json') {
            stream.write('[\n');
          }

          for await (const page of generator) {
            if (token.isCancellationRequested) {
              break;
            }

            if (page.columns && firstPage && (format === 'csv' || format === 'tsv')) {
              const separator = format === 'csv' ? ',' : '\t';
              const header =
                page.columns.map(c => this._escapeCsv(c.name, separator)).join(separator) + '\n';
              stream.write(header);
              firstPage = false;
            }

            if (page.data) {
              const separator = format === 'csv' ? ',' : '\t';
              for (const row of page.data) {
                if (format === 'json') {
                  const prefix = rowCount > 0 ? ',\n' : '';
                  stream.write(prefix + JSON.stringify(row));
                } else {
                  const line = row.map(v => this._escapeCsv(v, separator)).join(separator) + '\n';
                  stream.write(line);
                }
                rowCount++;
              }
            }
            progress.report({ message: `Exported ${rowCount} rows...` });
          }

          if (format === 'json') {
            stream.write('\n]');
          }

          vscode.window
            .showInformationMessage(
              `✅ Export complete: ${rowCount} rows saved.`,
              'Reveal in Finder'
            )
            .then(selection => {
              if (selection === 'Reveal in Finder') {
                vscode.commands.executeCommand('revealFileInOS', saveUri);
              }
            });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Export failed: ${err.message}`);
        } finally {
          stream.end();
        }
      }
    );
  }

  private _escapeCsv(val: any, separator: string): string {
    if (val === null || val === undefined) {
      return '';
    }
    const str = String(val);
    if (str.includes(separator) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    // Using unpkg for simplicity in this example, but should bundle for production
    const agGridScriptUri =
      'https://unpkg.com/ag-grid-community@31.3.2/dist/ag-grid-community.min.js';
    const agGridStylesUri = 'https://unpkg.com/ag-grid-community@31.3.2/styles/ag-grid.css';
    const agGridThemeStylesUri =
      'https://unpkg.com/ag-grid-community@31.3.2/styles/ag-theme-quartz.css';

    const csp = `
        default-src 'none'; 
        script-src 'nonce-${nonce}' https://unpkg.com;
        style-src ${webview.cspSource} 'unsafe-inline' https://unpkg.com;
        font-src ${webview.cspSource} https://unpkg.com https: data:;
        img-src ${webview.cspSource} https://unpkg.com https: data:;
        connect-src https://*.myteksi.net https://sentry.io ${webview.cspSource};
    `;

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'resultsView.js')
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'resultsView.css')
    );
    const customFontSize = vscode.workspace
      .getConfiguration('sqlPreview')
      .get<number>('fontSize', 0);

    return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="${csp}">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<link href="${agGridStylesUri}" rel="stylesheet">
			<link href="${agGridThemeStylesUri}" rel="stylesheet">
			<link href="${stylesUri}" rel="stylesheet">
            <style nonce="${nonce}">
                :root {
					${customFontSize > 0 ? `font-size: ${customFontSize}px;` : ''}
				}
            </style>
			<title>SQL Preview Results</title>
		</head>
		<body>
			<div id="tab-container" class="tab-container">
                <div id="active-file-indicator" class="active-file-indicator" style="display:none;"></div>
				<div id="tab-list" class="tab-list"></div>
				<button id="new-tab-button" class="new-tab-button" title="New Query Tab">+</button>
			</div>
			<div id="tab-content-container" class="tab-content-container">
				<div id="no-tabs-message" class="no-tabs-message">
					<p>Execute a SQL query to create your first results tab</p>
				</div>
			</div>
			<script nonce="${nonce}" src="${agGridScriptUri}"></script>
			<script nonce="${nonce}" src="${scriptUri}"></script>
		</body>
		</html>`;
  }
}
