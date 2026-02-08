import { Logger } from '../../../core/logging/Logger';
import * as vscode from 'vscode';
import { TabData, ExtensionToWebviewMessage, QueryResults } from '../../../common/types';
import { StateManager } from '../../../services/StateManager';
import { TabManager } from '../../../services/TabManager';
import { ExportService } from '../../../services/ExportService';
import { QuerySessionRegistry } from '../../../services/QuerySessionRegistry';
import { ConnectionManager } from '../../../services/ConnectionManager';
import { QueryExecutor } from '../../../core/execution/QueryExecutor';
import { ResultsHtmlGenerator } from './ResultsHtmlGenerator';
import { ResultsMessageHandler, MessageHandlerDelegate } from './ResultsMessageHandler';

/**
 * Manages the webview panel for displaying query results.
 * Refactored to delegate HTML generation and message handling.
 */
export class ResultsViewProvider implements vscode.WebviewViewProvider, MessageHandlerDelegate {
  public static readonly viewType = 'sqlResultsView';

  private _view?: vscode.WebviewView | undefined;
  private _resultCounter = 1;

  private _activeEditorUri: string | undefined;
  private _stateManager: StateManager;
  private _disposables: vscode.Disposable[] = [];

  private _htmlGenerator: ResultsHtmlGenerator;
  private _messageHandler: ResultsMessageHandler;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    private readonly _tabManager: TabManager,
    private readonly _exportService: ExportService,
    _querySessionRegistry: QuerySessionRegistry,
    _connectionManager: ConnectionManager,
    _queryExecutor: QueryExecutor,
    private readonly _daemonClient: { closeTab: (tabId: string) => Promise<void> } // Inject DaemonClient interface
  ) {
    this._stateManager = new StateManager(context);
    this._htmlGenerator = new ResultsHtmlGenerator(_extensionUri);
    this._messageHandler = new ResultsMessageHandler(
      this,
      _tabManager,
      _exportService,
      _querySessionRegistry,
      _connectionManager,
      _queryExecutor,
      _extensionUri
    );

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
          this.filterTabsByFile(this._activeEditorUri);
        } else {
          this.filterTabsByFile(undefined);
        }
      })
    );

    // Listen for configuration changes
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('sqlPreview')) {
          this.refreshSettings().catch(err => this.log(`Error refreshing settings: ${err}`));
        }
      })
    );
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

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

    webviewView.webview.html = this._htmlGenerator.getHtmlForWebview(webviewView.webview);
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

        this.postMessage({ type: 'updateFontSize', fontSize: fontSizeValue });
      }

      if (e.affectsConfiguration('sqlPreview.rowHeight')) {
        const config = vscode.workspace.getConfiguration('sqlPreview');
        const density = config.get<string>('rowHeight', 'normal');
        this.postMessage({ type: 'updateRowHeight', density });
      }

      if (e.affectsConfiguration('sqlPreview.mcpEnabled')) {
        this.refreshSettings();
      }
    });

    webviewView.onDidDispose(() => {
      configListener.dispose();
      this._view = undefined;
    });

    webviewView.webview.onDidReceiveMessage(async data => {
      await this._messageHandler.handleMessage(data);
    });
  }

  // --- MessageHandlerDelegate Implementation ---

  public postMessage(message: ExtensionToWebviewMessage) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  public getActiveEditorUri(): string | undefined {
    return this._activeEditorUri;
  }

  public async saveState() {
    await this._saveState();
  }

  public restoreTabs() {
    this._restoreTabsToWebview();
  }

  public async refreshSettings(): Promise<void> {
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
    const hasPassword = false;

    this.postMessage({
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
        mcpEnabled: config.get('mcpEnabled'),

        defaultConnector: config.get('defaultConnector'),
        databasePath: config.get('databasePath'),

        hasPassword,
        mcpStatus: {
          running: !!config.get('mcpEnabled'),
          port: process.env['SQL_PREVIEW_MCP_PORT']
            ? parseInt(process.env['SQL_PREVIEW_MCP_PORT'], 10)
            : 8414,
          error: false,
        },
      },
    });
  }

  public filterTabsByFile(fileUri: string | undefined) {
    if (!fileUri) {
      return;
    }

    const visibleTabs = this._tabManager.getAllTabs().filter(tab => tab.sourceFileUri === fileUri);
    let activeTabIsValid = false;
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      const activeTab = this._tabManager.getTab(activeId);
      if (activeTab && activeTab.sourceFileUri === fileUri) {
        activeTabIsValid = true;
      }
    }

    if (!activeTabIsValid) {
      if (visibleTabs.length > 0) {
        const lastTab = visibleTabs[visibleTabs.length - 1];
        if (lastTab) {
          this._tabManager.setActiveTab(lastTab.id);
        }
      } else {
        this._tabManager.setActiveTab(undefined);
      }
    }

    if (this._view) {
      const fileName = fileUri ? decodeURIComponent(fileUri).split('/').pop() : undefined;
      this._view.webview.postMessage({ type: 'filterTabs', fileUri, fileName });
    }
  }

  // --- Public methods ---

  public showLoadingForTab(tabId: string, query: string, title: string) {
    this.log(`showLoadingForTab: ${tabId}`);

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
    this.postMessage({ type: 'showLoading', tabId, query, title });
  }

  public updateTab(tabId: string, updates: Partial<TabData>) {
    this._tabManager.updateTab(tabId, updates);
    this._saveState();
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

    this._tabManager.addTab(newData);
    this._tabManager.setActiveTab(tabId);
    this._saveState();

    this._ensureVisible();
    this.postMessage({
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
    this.postMessage({
      type: 'queryError',
      tabId,
      error: { message, details },
      query,
      title,
    });
  }

  public showStatusMessage(message: string) {
    this._ensureVisible();
    this.postMessage({ type: 'statusMessage', message });
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
    this.postMessage({ type: 'createTab', tabId, query, title, sourceFileUri });
  }

  public getOrCreateActiveTabId(query: string, title?: string, sourceFileUri?: string): string {
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      const existing = this._tabManager.getTab(activeId);

      if (existing && (!sourceFileUri || existing.sourceFileUri === sourceFileUri)) {
        const updates: Partial<TabData> = { query };
        if (title) {
          updates.title = title;
        }
        this._tabManager.updateTab(activeId, updates);

        this._saveState();

        this._ensureVisible();
        this.postMessage({
          type: 'reuseOrCreateActiveTab',
          tabId: activeId,
          query,
          title: title || existing.title,
          sourceFileUri,
        });
        return activeId;
      }
    }

    const newTabId = `t${Math.random().toString(36).substring(2, 10)}`;
    this.createTabWithId(newTabId, query, title || 'Result', sourceFileUri);
    return newTabId;
  }

  // --- Convenience methods ---

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

  public createTab(query: string, title?: string) {
    const tabId = `t${Math.random().toString(36).substring(2, 10)}`;
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

  public async closeTab(tabId: string) {
    if (this._tabManager.getTab(tabId)) {
      this._tabManager.removeTab(tabId);
      this.postMessage({ type: 'closeTab', tabId });

      // Notify Daemon to remove tab from session
      try {
        await this._daemonClient.closeTab(tabId);
      } catch (err) {
        this.log(`Error closing remote tab: ${err}`);
      }

      await this._saveState();
    }
  }

  public closeOtherTabs() {
    const activeId = this._tabManager.activeTabId;
    if (activeId) {
      const tabsToClose = this._tabManager.getAllTabs().filter(t => t.id !== activeId);

      this._tabManager.removeOtherTabs(activeId);
      this.postMessage({ type: 'closeOtherTabs' });
      this._saveState();

      // Notify Daemon
      tabsToClose.forEach(tab => {
        this._daemonClient.closeTab(tab.id).catch(err => {
          this.log(`Error closing remote tab: ${err}`);
        });
      });
    }
  }

  public getLastActiveFileUri(): vscode.Uri | undefined {
    return this._activeEditorUri ? vscode.Uri.parse(this._activeEditorUri) : undefined;
  }

  public log(message: string) {
    Logger.getInstance().info(message);
  }

  public dispose() {
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }

  public closeAllTabs() {
    const tabsToClose = this._tabManager.getAllTabs();

    this._tabManager.removeAllTabs();
    this.postMessage({ type: 'closeAllTabs' });
    this._saveState();

    // Notify Daemon
    tabsToClose.forEach(tab => {
      this._daemonClient.closeTab(tab.id).catch(err => {
        this.log(`Error closing remote tab: ${err}`);
      });
    });
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public syncRemoteTabs(sessions: any[], currentSessionId: string) {
    // We want to merge remote tabs into our local view
    let changes = false;

    for (const session of sessions) {
      if (session.id !== currentSessionId) {
        continue;
      }

      if (session.tabs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const remoteTab of session.tabs) {
          // Check if we already have this tab (by ID or by remoteId mapping)
          const existing = this._tabManager
            .getAllTabs()
            .find(t => t.id === remoteTab.tabId || t.remoteId === remoteTab.tabId);

          if (!existing) {
            // New Remote Tab
            this.createTabWithId(
              remoteTab.tabId,
              remoteTab.query,
              `Remote: ${remoteTab.tabId}`,
              undefined
            );
            const tab = this._tabManager.getTab(remoteTab.tabId);
            if (tab) {
              tab.isRemote = true;
              tab.sessionId = session.id; // Use session.id from the loop variable
              tab.status = remoteTab.status;
              tab.title = `Remote: ${remoteTab.tabId}`; // Maybe use session name?
              // We don't have columns/rows here, we'd need to fetch them.
            }
            changes = true;
          } else {
            // Update status
            if (existing.status !== remoteTab.status) {
              existing.status = remoteTab.status;
              changes = true;
            }
          }
        }
      }
    }

    if (changes) {
      this._saveState();
      // Do not call restoreTabs() here; it sends duplicate 'createTab' messages.
      // The internal state is updated, and QueryExecutor or subsequent user actions will handle UI updates.
      // If we need to push status updates (e.g. loading -> success) for "ghost" tabs,
      // we should send specific update messages, but 'restoreTabs' is too heavy/destructive.
    }
  }

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
      this.postMessage({
        type: 'createTab',
        tabId: tab.id,
        query: tab.query,
        title: tab.title,
        sourceFileUri: tab.sourceFileUri,
      });

      if (tab.status === 'success') {
        if (tab.wasDataCleared) {
          this.postMessage({
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
            supportsPagination: tab.supportsPagination,
          };
          this.postMessage({
            type: 'resultData',
            tabId: tab.id,
            data: queryResults,
            title: tab.title,
          });
        }
      } else if (tab.status === 'error') {
        this.postMessage({
          type: 'queryError',
          tabId: tab.id,
          error: { message: tab.error || 'Unknown', details: tab.errorDetails },
          title: tab.title,
        });
      } else if (tab.status === 'loading') {
        this.postMessage({ type: 'showLoading', tabId: tab.id, title: tab.title });
      }
    });
  }
}
