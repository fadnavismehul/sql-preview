import * as vscode from 'vscode';
import { TabData, ExtensionToWebviewMessage, QueryResults } from './common/types';
import { StateManager } from './services/StateManager';
import { TabManager } from './services/TabManager';
import { ExportService } from './services/ExportService';
import { QuerySessionRegistry } from './services/QuerySessionRegistry';
import { getNonce } from './utils/nonce';

/**
 * Manages the webview panel for displaying query results.
 * It handles:
 * - Creating and initializing the webview HTML.
 * - Receiving messages from the extension (e.g., query results, errors).
 * - Sending messages from the webview back to the extension.
 *
 * Refactored to delegate state management to TabManager and export to ExportService.
 */
export class ResultsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sqlResultsView';

  private _view?: vscode.WebviewView | undefined;
  private _outputChannel: vscode.OutputChannel;
  private _resultCounter = 1;
  private _activeEditorUri: string | undefined;
  private _stateManager: StateManager;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    private readonly _tabManager: TabManager,
    private readonly _exportService: ExportService,
    private readonly _querySessionRegistry: QuerySessionRegistry
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
          // Current behavior: show all if undefined?
          // Originally: if undefined, hide all.
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

      if (e.affectsConfiguration('sqlPreview.rowHeight')) {
        const config = vscode.workspace.getConfiguration('sqlPreview');
        const density = config.get<string>('rowHeight', 'normal');
        this._postMessage({ type: 'updateRowHeight', density });
      }
    });

    // Initial configuration is sent when 'webviewLoaded' is received

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
        case 'webviewLoaded': {
          this._restoreTabsToWebview();
          if (this._activeEditorUri) {
            this._filterTabsByFile(this._activeEditorUri);
          }
          // Send current row height setting
          const config = vscode.workspace.getConfiguration('sqlPreview');
          const density = config.get<string>('rowHeight', 'normal');
          this._postMessage({ type: 'updateRowHeight', density });
          return;
        }
        case 'tabClosed':
          this.log(`Tab closed: ${data.tabId}`);
          this._tabManager.removeTab(data.tabId);
          this._saveState();
          return;
        case 'updateTabState': {
          const updates: Partial<TabData> = {};
          if (data.title) {
            updates.title = data.title;
          }
          if (data.query) {
            updates.query = data.query;
          }
          this._tabManager.updateTab(data.tabId, updates);
          this._saveState();
          return;
        }
        case 'tabSelected':
          this._tabManager.setActiveTab(data.tabId);
          this._saveState();
          return;
        case 'exportResults': {
          const tab = this._tabManager.getTab(data.tabId);
          if (tab) {
            this._exportService.exportResults(tab);
          }
          return;
        }
        case 'cancelQuery': {
          this.log(`Cancelling query for tab: ${data.tabId}`);
          this._querySessionRegistry.cancelSession(data.tabId);
          return;
        }
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
    const existing = this._tabManager.getTab(tabId);
    if (existing) {
      this._tabManager.updateTab(tabId, {
        status: 'loading',
        query,
        title,
      });
    }
    this._saveState();

    this._ensureVisible();
    this._postMessage({ type: 'showLoading', tabId, query, title });
  }

  public showResultsForTab(tabId: string, resultData: QueryResults) {
    this.log(`showResultsForTab: ${tabId}`);

    const existing = this._tabManager.getTab(tabId);
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

    this._tabManager.addTab(newData); // upsert
    this._tabManager.setActiveTab(tabId);
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

    const existing = this._tabManager.getTab(tabId);
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

    this._tabManager.addTab(newData);
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

    this._tabManager.addTab({
      id: tabId,
      title,
      query,
      columns: [],
      rows: [],
      status: 'created',
      sourceFileUri,
    });
    this._tabManager.setActiveTab(tabId);
    this._saveState();

    this._ensureVisible();
    this._postMessage({ type: 'createTab', tabId, query, title, sourceFileUri });
  }

  public getOrCreateActiveTabId(query: string, title?: string, sourceFileUri?: string): string {
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      const existing = this._tabManager.getTab(activeId);

      // Validation: Ensure we don't reuse a tab from a different file
      if (existing && (!sourceFileUri || existing.sourceFileUri === sourceFileUri)) {
        const updates: Partial<TabData> = { query };
        if (title) {
          updates.title = title;
        }
        this._tabManager.updateTab(activeId, updates);
        // sourceFileUri match is already confirmed or ignored

        this._saveState();

        this._ensureVisible();
        this._postMessage({
          type: 'reuseOrCreateActiveTab',
          tabId: activeId,
          query,
          title: title || existing.title,
          sourceFileUri,
        });
        return activeId;
      }
      // If mismatch, fall through to create new tab
    }

    const newTabId = `tab-${Date.now()}`;
    this.createTabWithId(newTabId, query, title || 'Result', sourceFileUri);
    return newTabId;
  }

  // --- Convenience methods for backward compatibility or single-tab usage ---

  public showLoading() {
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      const tab = this._tabManager.getTab(activeId);
      if (tab) {
        this.showLoadingForTab(activeId, tab.query, tab.title);
      }
    }
  }

  public showResults(data: any) {
    // Compatibility wrapper for tests
    // Need to map 'any' to QueryResults strictly
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
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
      this.showResultsForTab(activeId, strictData);
    }
  }

  public showError(message: string, details?: string) {
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      this.showErrorForTab(activeId, message, details);
    }
  }

  /** Creates a new tab (convenience wrapper) - Generates ID automatically */
  public createTab(query: string, title?: string) {
    const tabId = `tab-${Date.now()}`;
    this.createTabWithId(tabId, query, title || 'Query Result');
  }

  // --- Public methods for MCP Server ---

  public getTabs(): TabData[] {
    return this._tabManager.getAllTabs();
  }

  public getTabData(tabId: string): TabData | undefined {
    return this._tabManager.getTab(tabId);
  }

  public getActiveTabId(): string | undefined {
    return this._tabManager.activeTabId;
  }

  public get activeEditorUri(): string | undefined {
    return this._activeEditorUri;
  }

  public getMaxResultCountForFile(fileUri: string | undefined): number {
    if (!fileUri) {
      return 0;
    }
    let maxCount = 0;
    this._tabManager.getAllTabs().forEach(tab => {
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
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      this.closeTab(activeId);
    }
  }

  public closeTab(tabId: string) {
    if (this._tabManager.getTab(tabId)) {
      this._tabManager.removeTab(tabId);
      this._postMessage({ type: 'closeTab', tabId });
      this._saveState();
    }
  }

  public closeOtherTabs() {
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      this._tabManager.removeOtherTabs(activeId);
      this._postMessage({ type: 'closeOtherTabs' });
      this._saveState();
    }
  }

  public closeAllTabs() {
    this._tabManager.removeAllTabs();
    this._postMessage({ type: 'closeAllTabs' });
    this._saveState();
  }

  public async exportFullResults() {
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      const tab = this._tabManager.getTab(activeId);
      if (tab) {
        await this._exportService.exportResults(tab);
      }
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
    await this._stateManager.saveState(this._tabManager.tabs, this._resultCounter);
  }

  private async _loadState() {
    const state = await this._stateManager.loadState();
    if (state) {
      this._tabManager.setTabs(state.tabs);
      this._resultCounter = state.resultCounter;
      this.log(`State loaded. Tabs: ${state.tabs.size}`);
    }
  }

  private _restoreTabsToWebview() {
    this._tabManager.getAllTabs().forEach(tab => {
      this._postMessage({
        type: 'createTab',
        tabId: tab.id,
        query: tab.query,
        title: tab.title,
        sourceFileUri: tab.sourceFileUri,
      });

      if (tab.status === 'success') {
        if (tab.wasDataCleared) {
          this._postMessage({
            type: 'queryError',
            tabId: tab.id,
            error: {
              message: 'Results not persisted.',
              details: 'Row data was cleared to save state. Please run the query again.',
            },
            title: tab.title,
          });
        } else if (tab.rows.length > 0) {
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
        }
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

    // Logic: If we switch files, we must ensure the active tab belongs to the visible set per fileUri.

    // 1. Determine which tabs are visible for this fileUri
    const visibleTabs = this._tabManager.getAllTabs().filter(tab => tab.sourceFileUri === fileUri);

    // 2. Check if current active tab is in the visible set
    let activeTabIsValid = false;
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      const activeTab = this._tabManager.getTab(activeId);
      if (activeTab && activeTab.sourceFileUri === fileUri) {
        activeTabIsValid = true;
      }
    }

    // 3. Update Active Tab ID if needed
    if (!activeTabIsValid) {
      if (visibleTabs.length > 0) {
        // Pick the last created one
        const lastTab = visibleTabs[visibleTabs.length - 1];
        if (lastTab) {
          this._tabManager.setActiveTab(lastTab.id);
        }
      } else {
        // No visible tabs for this file (or cleared view)
        // Should we clear active tab?
        // _tabManager.setActiveTab(undefined);
        // Original code set _activeTabId = undefined.
        this._tabManager.setActiveTab(undefined);
      }
    }

    if (this._view) {
      // Extract filename for display
      const fileName = fileUri ? fileUri.split('/').pop() : undefined;
      // Note: filterTabs message tells the webview which file is active, webview filters DOM?
      // Assuming existing webview logic for 'filterTabs' works with this message.
      this._view.webview.postMessage({ type: 'filterTabs', fileUri, fileName });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    // Reverting to AG Grid Community (Enterprise features removed per user request)
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
        connect-src https://sentry.io ${webview.cspSource};
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
