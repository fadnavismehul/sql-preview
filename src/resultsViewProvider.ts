import * as vscode from 'vscode';
import { TabData, ExtensionToWebviewMessage, QueryResults } from './common/types';
import { StateManager } from './services/StateManager';
import { TabManager } from './services/TabManager';
import { ExportService } from './services/ExportService';
import { QuerySessionRegistry } from './services/QuerySessionRegistry';
import { ConnectionManager } from './services/ConnectionManager';

import { AuthManager } from './services/AuthManager';
import { QueryExecutor } from './core/execution/QueryExecutor';
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
  private _authManager: AuthManager;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    private readonly _tabManager: TabManager,
    private readonly _exportService: ExportService,
    private readonly _querySessionRegistry: QuerySessionRegistry,

    private readonly _connectionManager: ConnectionManager,
    private readonly _queryExecutor: QueryExecutor
  ) {
    this._outputChannel = vscode.window.createOutputChannel('SQL Preview');
    this._stateManager = new StateManager(context);
    this._authManager = new AuthManager(context);

    // Initialize active editor if already open
    if (
      vscode.window.activeTextEditor &&
      vscode.window.activeTextEditor.document.languageId === 'sql'
    ) {
      this._activeEditorUri = vscode.window.activeTextEditor.document.uri.toString();
    }

    // Load state
    this._loadState();

    // Listen for active editor changes
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document && editor.document.languageId === 'sql') {
          this._activeEditorUri = editor.document.uri.toString();
          this._filterTabsByFile(this._activeEditorUri);
        } else {
          // If switching to non-SQL file or no editor, keep the last active SQL context
          // This allows MCP and the view to persist the relevant tabs (e.g. when using Chat)
          // this._activeEditorUri = undefined; // REMOVED clearing

          // Optionally update view to reflect we aren't "in" the file anymore?
          // Current logic: _filterTabsByFile(undefined) invokes "persistence" mode (returns early).
          // But if we want to ensure MCP works, we want _activeEditorUri to be preserved.

          this._filterTabsByFile(undefined);
        }
      })
    );

    // Listen for configuration changes
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('sqlPreview')) {
          this._refreshSettings().catch(err => this.log(`Error refreshing settings: ${err}`));
        }
      })
    );
  }

  public dispose() {
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }

  public getLastActiveFileUri(): vscode.Uri | undefined {
    return this._activeEditorUri ? vscode.Uri.parse(this._activeEditorUri) : undefined;
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
    this.log('Webview HTML requested and set.');

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

    webviewView.webview.onDidReceiveMessage(async data => {
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
          // eslint-disable-next-line no-console
          this._refreshConnections().catch(err => this.log(String(err)));
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
        case 'testConnection': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const config = data.config;

          const workspaceConfig = vscode.workspace.getConfiguration('sqlPreview');
          const connectorType = workspaceConfig.get<string>('defaultConnector', 'trino');

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let testConfig: any;
          let authHeader: string | undefined;

          if (connectorType === 'sqlite') {
            testConfig = {
              databasePath: config.databasePath,
            };
            // SQLite doesn't use auth header usually
          } else {
            // Trino
            const pwd = await this._authManager.getPassword();
            authHeader = pwd
              ? `Basic ${Buffer.from(`${config.user}:${pwd}`).toString('base64')}`
              : undefined;

            testConfig = {
              host: config.host,
              port: parseInt(config.port, 10),
              user: config.user,
              catalog: config.catalog,
              schema: config.schema,
              ssl: config.ssl,
              sslVerify: config.sslVerify,
              maxRows: 1,
            };
          }

          const result = await this._queryExecutor.testConnection(
            connectorType,
            testConfig,
            authHeader
          );
          this._postMessage({
            type: 'testConnectionResult',
            success: result.success,
            ...(result.error ? { error: result.error } : {}),
          } as ExtensionToWebviewMessage);
          return;
        }
        case 'refreshSettings': {
          await this._refreshSettings();
          return;
        }
        case 'saveSettings': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const s = data.settings as any;
          // Determine scope: if we have a workspace, write to it. Else Global.
          // Or just let VS Code decide (defaults to Workspace if open).
          // However, if we want to force "user settings" (Global), we pass Global.
          // BUT if the user has a Workspace setting overriding it, Global writes are ignored.
          // SO we should pass undefined to let it write to Workspace, overriding the current workspace setting.

          let resource: vscode.Uri | undefined;
          if (this._activeEditorUri) {
            try {
              resource = vscode.Uri.parse(this._activeEditorUri);
            } catch (e) {
              // Ignore invalid URIs
            }
          } else {
            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length > 0) {
              resource = folders[0]?.uri;
            }
          }

          const config = vscode.workspace.getConfiguration('sqlPreview', resource);

          // Helper to write to correct target (Global Default, Workspace Override Maintenance)
          const writeConfig = async (key: string, value: unknown) => {
            const inspect = config.inspect(key);
            const target =
              inspect?.workspaceValue !== undefined
                ? vscode.ConfigurationTarget.Workspace
                : vscode.ConfigurationTarget.Global;
            await config.update(key, value, target);
          };

          // Batch updates
          await Promise.all([
            writeConfig('maxRowsToDisplay', s.maxRowsToDisplay),
            writeConfig('fontSize', s.fontSize),
            writeConfig('rowHeight', s.rowHeight),
            writeConfig('tabNaming', s.tabNaming),

            writeConfig('host', s.host),
            writeConfig('port', s.port),
            writeConfig('user', s.user),
            writeConfig('catalog', s.catalog),
            writeConfig('schema', s.schema),
            writeConfig('ssl', s.ssl),
            writeConfig('sslVerify', s.sslVerify),

            writeConfig('mcpEnabled', s.mcpEnabled),
            writeConfig('mcpPort', s.mcpPort),
            writeConfig('defaultConnector', s.defaultConnector),
            writeConfig('databasePath', s.databasePath),
          ]);

          // Sync with ConnectionManager (Default Profile)
          const existing = await this._connectionManager.getConnections();
          const profileId =
            existing.length > 0 && existing[0] ? existing[0].id : 'default-' + Date.now();

          let profile: import('./common/types').ConnectionProfile;
          if (s.defaultConnector === 'sqlite') {
            profile = {
              id: profileId,
              name: 'Default Connection',
              type: 'sqlite',
              databasePath: s.databasePath || '',
            };
          } else {
            profile = {
              id: profileId,
              name: 'Default Connection',
              type: 'trino',
              host: s.host || 'localhost',
              port: s.port || 8080,
              user: s.user || 'user',
              catalog: s.catalog,
              schema: s.schema,
              ssl: s.ssl || false,
              sslVerify: s.sslVerify !== false,
            };
          }
          await this._connectionManager.saveConnection(profile);

          // Refresh settings to confirm
          const hasPassword = (await this._authManager.getPassword()) !== undefined;
          this._postMessage({
            type: 'updateConfig',
            config: {
              ...s,
              hasPassword,
            },
          });

          vscode.window.setStatusBarMessage('SQL Preview settings saved.', 2000);
          return;
        }
        case 'setPassword':
          vscode.commands.executeCommand('sql.setPassword').then(() => {
            // Refresh after delay to pick up change
            setTimeout(() => {
              this._view?.webview.postMessage({ command: 'refreshSettings' }); // Hacky loopback
            }, 1000);
          });
          return;
        case 'clearPassword':
          vscode.commands.executeCommand('sql.clearPassword');
          return;
        case 'logMessage':
          this.log(`[Webview ${data.level.toUpperCase()}] ${data.message}`);
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

  public showResults(data: QueryResults) {
    // Compatibility wrapper for tests
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      this.showResultsForTab(activeId, data);
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

  private async _refreshConnections() {
    const connections = await this._connectionManager.getConnections();
    // Passwords are not returned by getConnections (except maybe empty/placeholder? No, service handles it)
    // Actually getConnections calls with true (includePassword)? No, we check ConnectionManager.
    // getConnections(includePassword = false) is default. We don't want passwords in UI.
    this._postMessage({ type: 'updateConnections', connections });
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
      const fileName = fileUri ? decodeURIComponent(fileUri).split('/').pop() : undefined;
      // Note: filterTabs message tells the webview which file is active, webview filters DOM?
      // Assuming existing webview logic for 'filterTabs' works with this message.
      this._view.webview.postMessage({ type: 'filterTabs', fileUri, fileName });
    }
  }

  private async _refreshSettings(): Promise<void> {
    let resource: vscode.Uri | undefined;
    if (this._activeEditorUri) {
      try {
        resource = vscode.Uri.parse(this._activeEditorUri);
      } catch (e) {
        // ignore
      }
    } else if (vscode.window.activeTextEditor) {
      resource = vscode.window.activeTextEditor.document.uri;
    } else {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        resource = folders[0]?.uri;
      }
    }

    const config = vscode.workspace.getConfiguration('sqlPreview', resource);
    const hasPassword = (await this._authManager.getPassword()) !== undefined;

    // Debugging

    this._postMessage({
      type: 'updateConfig',
      config: {
        maxRowsToDisplay: config.get('maxRowsToDisplay'),
        fontSize: config.get('fontSize'),
        rowHeight: config.get('rowHeight'),
        tabNaming: config.get('tabNaming'),
        host: config.get('host'),
        port: config.get('port'),
        user: config.get('user'),
        catalog: config.get('catalog'),
        schema: config.get('schema'),
        ssl: config.get('ssl'),
        sslVerify: config.get('sslVerify'),
        mcpPort: config.get('mcpPort'),
        defaultConnector: config.get('defaultConnector'),
        databasePath: config.get('databasePath'),
        hasPassword,
      },
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    // Local Vendor Assets for AG Grid (Community)
    const agGridScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'media',
        'vendor',
        'ag-grid',
        'ag-grid-community.min.js'
      )
    );
    const agGridStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'vendor', 'ag-grid', 'ag-grid.min.css')
    );
    const agGridThemeStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'media',
        'vendor',
        'ag-grid',
        'ag-theme-quartz.min.css'
      )
    );

    const csp = `
        default-src 'none'; 
        script-src 'nonce-${nonce}' ${webview.cspSource};
        style-src ${webview.cspSource} 'unsafe-inline';
        font-src ${webview.cspSource} https: data:;
        img-src ${webview.cspSource} https: data:;
        connect-src https://sentry.io ${webview.cspSource};
    `;

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'resultsView.js')
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'resultsView.css')
    );
    const themeStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'theme.css')
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
            <link href="${themeStylesUri}" rel="stylesheet">
			<link href="${stylesUri}" rel="stylesheet">
            <style nonce="${nonce}">
                :root {
					${customFontSize > 0 ? `font-size: ${customFontSize}px;` : ''}
				}
            </style>
			<title>SQL Preview Results</title>
		</head>
		<body>
			<!-- Main View: Tabs and Results -->
            <div id="main-view" class="view-container">
                <div id="tab-container" class="tab-container">
                    <div id="tab-list" class="tab-list"></div>
                    <div id="active-file-indicator" class="active-file-indicator" style="display:none;"></div>
                    <button id="connections-button" class="icon-button" title="Manage Connections" style="background:none;border:none;color:var(--vscode-foreground);cursor:pointer;padding:4px;">
                        <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.2.7-2.4.5v1.2l2.4.5.3.8-1.3 2 .8.8 2-1.3.8.3.4 2.4h1.2l.5-2.4.8-.3 2 1.3.8-.8-1.3-2 .3-.8 2.3-.4V7.4l-2.4-.5-.3-.8 1.3-2-.8-.8-2 1.3-.7-.2zM8 11c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3-1.3 3-3 3z"/></svg>
                    </button>
                </div>
                
                <div id="tab-content-container" class="tab-content-container">
                    <div id="no-tabs-message" class="no-tabs-message">
                        <p>Execute a SQL query to create your first results tab</p>
                    </div>
                </div>
            </div>

            <!-- Settings View -->
            <div id="settings-view" class="view-container" style="display:none;">
                <div class="settings-view-content">
                    <div class="manager-header">
                        <div style="display:flex;align-items:center;gap:15px;">
                            <button id="close-settings" class="icon-button" title="Back to Results">
                                <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.78 2.22a.75.75 0 0 1 0 1.06L4.56 6.5h8.69a.75.75 0 0 1 0 1.5H4.56l3.22 3.22a.75.75 0 1 1-1.06 1.06l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 0 1 1.06 0z"/></svg>
                            </button>
                            <h2>Settings</h2>
                        </div>
                    </div>
                    <div class="settings-grid">
                        <!-- Left Column: User Preferences -->
                        <div class="settings-column">
                            <h3>User Preferences</h3>
                            
                            <div class="form-row">
                                <div class="form-group" style="flex:1;">
                                    <label>Max Rows</label>
                                    <input type="number" id="cfg-maxRowsToDisplay" placeholder="500">
                                </div>
                                <div class="form-group" style="flex:1;">
                                    <label>Font Size (px)</label>
                                    <input type="number" id="cfg-fontSize" placeholder="Inherit">
                                </div>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group" style="flex:1;">
                                    <label>Row Height</label>
                                    <select id="cfg-rowHeight">
                                        <option value="compact">Compact</option>
                                        <option value="normal">Normal</option>
                                        <option value="comfortable">Comfortable</option>
                                    </select>
                                </div>
                                <div class="form-group" style="flex:1;">
                                    <label>Tab Naming</label>
                                    <select id="cfg-tabNaming">
                                        <option value="query-snippet">Query Content</option>
                                        <option value="file-sequential">Sequential</option>
                                    </select>
                                </div>
                            </div>

                        </div>

                        <!-- Right Column: System Settings -->
                        <div class="settings-column">
                            <h3>System Settings</h3>
                            
                            <!-- Connection Card -->
                            <div class="settings-card">
                                <div class="card-header">
                                    <h4>Database Connection</h4>
                                    <span class="card-subtitle">Configure your default connection.</span>
                                </div>
                                
                                <div class="card-content">
                                    <div class="form-group">
                                        <label>Connector Type</label>
                                        <select id="cfg-defaultConnector">
                                            <option value="trino">Trino / Presto</option>
                                            <option value="sqlite">SQLite</option>
                                        </select>
                                    </div>

                                    <!-- Trino Fields -->
                                    <div id="cfg-group-trino" class="connector-group">
                                        <div class="form-group">
                                            <label>Host</label>
                                            <input type="text" id="cfg-host" placeholder="localhost">
                                        </div>

                                        <div class="form-row">
                                            <div class="form-group" style="flex:1;">
                                                <label>Port</label>
                                                <input type="number" id="cfg-port" value="8080">
                                            </div>
                                            <div class="form-group" style="flex:2;">
                                                <label>User</label>
                                                <input type="text" id="cfg-user" placeholder="admin">
                                            </div>
                                        </div>

                                        <div class="form-row">
                                            <div class="form-group" style="flex:1;">
                                                <label>Catalog</label>
                                                <input type="text" id="cfg-catalog" placeholder="Optional">
                                            </div>
                                            <div class="form-group" style="flex:1;">
                                                <label>Schema</label>
                                                <input type="text" id="cfg-schema" placeholder="Optional">
                                            </div>
                                        </div>

                                        <div class="form-group">
                                            <label>Password</label>
                                            <div class="input-with-actions">
                                                <span id="password-status" class="status-badge">(Checking...)</span>
                                                <button id="set-password-btn" class="secondary-button small">Set</button>
                                                <button id="clear-password-btn" class="danger-button small">Clear</button>
                                            </div>
                                        </div>

                                        <div class="checkbox-row">
                                            <label><input type="checkbox" id="cfg-ssl"> Enable SSL</label>
                                            <label><input type="checkbox" id="cfg-sslVerify"> Verify Cert</label>
                                        </div>
                                    </div>

                                    <!-- SQLite Fields -->
                                    <div id="cfg-group-sqlite" class="connector-group" style="display:none;">
                                        <div class="form-group">
                                            <label>Database Path</label>
                                            <input type="text" id="cfg-databasePath" placeholder="/path/to/database.db">
                                            <small style="color:var(--vscode-descriptionForeground);display:block;margin-top:4px;">Absolute path to the SQLite file.</small>
                                        </div>
                                    </div>

                                    <div class="form-group" style="margin-top: 15px;">
                                        <button id="test-connection-btn" class="secondary-button" style="width: auto;">Test Connection</button>
                                        <span id="test-connection-status" class="status-badge" style="margin-left: 10px;"></span>
                                    </div>
                                </div>
                            </div>

                            <!-- Experimental Features Card -->
                            <div class="settings-card experimental">
                                <div class="card-header">
                                    <h4>Experimental Features</h4>
                                </div>
                                <div class="card-content">
                                    <div class="warning-callout">
                                        <span class="icon">⚠️</span>
                                        <p>These features are in beta and may be unstable.</p>
                                    </div>

                                    <div class="form-row align-center" style="margin-top:10px;">
                                        <label class="toggle-label"><input type="checkbox" id="cfg-mcpEnabled"> Enable MCP Server</label>
                                        <div class="form-group horizontal" style="margin-left:auto;">
                                            <label>Port</label>
                                            <input type="number" id="cfg-mcpPort" value="3000" style="width:80px;">
                                        </div>
                                    </div>

                                    <div class="mcp-info">
                                        <p>Add to <code>mcp.json</code>:</p>
                                        <div class="code-snippet">
                                            <pre>"preview": { "url": "http://localhost:3000/sse" }</pre>
                                            <button id="copy-mcp-config" class="icon-button" title="Copy">📋</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="tab-context-menu" class="context-menu">
                <div class="context-menu-item" id="ctx-copy-query">Copy Query</div>
                <div class="context-menu-separator" style="height:1px; background:var(--vscode-menu-separatorBackground); margin:4px 0;"></div>
                <div class="context-menu-item" id="ctx-close">Close</div>
                <div class="context-menu-item" id="ctx-close-others">Close Others</div>
                <div class="context-menu-item" id="ctx-close-all">Close All</div>
            </div>
			<script nonce="${nonce}" src="${agGridScriptUri}"></script>
			<script nonce="${nonce}" src="${scriptUri}"></script>
		</body>
		</html>`;
  }
}
