import * as vscode from 'vscode';
import { mockWebviewPanel, mockWorkspaceConfig } from '../setup';
import { ResultsViewProvider } from '../../ui/webviews/results/ResultsViewProvider';
import { TabManager } from '../../services/TabManager';
import { ExportService } from '../../services/ExportService';
import { QuerySessionRegistry } from '../../services/QuerySessionRegistry';
import axios from 'axios';
import * as path from 'path';
import * as packageJson from '../../../package.json';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ResultsViewProvider Tests', () => {
  let resultsViewProvider: ResultsViewProvider;
  let mockWebviewView: any;
  let mockDaemonClient: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDaemonClient = {
      closeTab: jest.fn().mockResolvedValue(undefined),
    };

    // Mock axios response for version check
    mockedAxios.post.mockResolvedValue({
      data: {
        results: [
          {
            extensions: [
              {
                versions: [{ version: '0.9.0' }],
              },
            ],
          },
        ],
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    } as any);

    mockWebviewView = {
      webview: mockWebviewPanel.webview,
      show: jest.fn(),
      onDidDispose: jest.fn(),
    };

    const mockContext = {
      extensionUri: vscode.Uri.file(path.resolve(__dirname, '../../..')), // Point to project root
      globalStorageUri: vscode.Uri.file('/mock/storage/path'),
      workspaceState: {
        get: jest.fn().mockReturnValue(undefined),
        update: jest.fn(),
      },
      subscriptions: [],
    } as any;
    const mockQueryExecutor = {
      executeQuery: jest.fn(),
      cancelQuery: jest.fn(),
    } as any;

    const tabManager = new TabManager();
    const exportService = new ExportService(mockQueryExecutor);
    const querySessionRegistry = new QuerySessionRegistry();

    resultsViewProvider = new ResultsViewProvider(
      mockContext.extensionUri,
      mockContext,
      tabManager,
      exportService,
      querySessionRegistry,
      {
        getConnections: jest.fn().mockResolvedValue([]),
        saveConnection: jest.fn(),
        deleteConnection: jest.fn(),
      } as any,
      { testConnection: jest.fn() } as any,
      mockDaemonClient
    );

    resultsViewProvider.resolveWebviewView(mockWebviewView);
  });

  it('should show results with truncation warning when results exceed maxRowsToDisplay', async () => {
    const tabId = 'tab-1';
    resultsViewProvider.createTabWithId(tabId, 'SELECT 1', 'Test Tab');

    const columns = [{ name: 'col1', type: 'varchar' }];
    const rows = Array(600).fill(['value']);
    const data = {
      columns,
      rows,
      query: 'SELECT * FROM test_table',
      wasTruncated: true,
      totalRowsInFirstBatch: 600,
      queryId: 'query_123',
      nextUri: 'http://localhost:8080/v1/query/123/next',
    };

    resultsViewProvider.showResults(data);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'resultData',
      tabId,
      title: 'Test Tab',
      data,
    });
  });

  it('should show results without truncation warning when results within limit', async () => {
    const tabId = 'tab-1';
    resultsViewProvider.createTabWithId(tabId, 'SELECT 1', 'Test Tab');

    const columns = [{ name: 'col1', type: 'varchar' }];
    const rows = Array(300).fill(['value']);
    const data = {
      columns,
      rows,
      query: 'SELECT * FROM test_table',
      wasTruncated: false,
      totalRowsInFirstBatch: 300,
      queryId: 'query_123',
    };

    resultsViewProvider.showResults(data);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'resultData',
      tabId,
      title: 'Test Tab',
      data,
    });
  });

  it('should send updateRowHeight message when webviewLoaded is received', async () => {
    // Mock config behavior just for this test
    mockWorkspaceConfig.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'rowHeight') {
        return 'normal';
      }
      return defaultValue;
    });

    // Get the onDidReceiveMessage handler registered in resolveWebviewView
    const onDidReceiveMessageMock = mockWebviewPanel.webview.onDidReceiveMessage as jest.Mock;

    // The handler is the first argument of the first call found
    const messageHandler = onDidReceiveMessageMock.mock.calls[0][0];

    // Simulate sending 'webviewLoaded'
    await messageHandler({ command: 'webviewLoaded' });

    // Verify 'updateRowHeight' was sent back
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'updateRowHeight',
        density: 'normal',
      })
    );

    // Verify version check was triggered
    // Since _checkLatestVersion is async and not awaited by webviewLoaded handler (it's fire-and-forget),
    // we need to wait for promises to resolve.
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'updateVersionInfo',
        currentVersion: packageJson.version,
      })
    );
  });

  it('should handle openExtensionPage message', async () => {
    // Get the onDidReceiveMessage handler
    const onDidReceiveMessageMock = mockWebviewPanel.webview.onDidReceiveMessage as jest.Mock;
    const messageHandler = onDidReceiveMessageMock.mock.calls[0][0];

    await messageHandler({ command: 'openExtensionPage' });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.extensions.action.showExtensionsWithIds',
      ['mehul.sql-preview']
    );
  });

  it('should show results for specific tab', async () => {
    const tabId = 'tab-123';
    resultsViewProvider.createTabWithId(tabId, 'SELECT 1', 'Query Results');

    const columns = [{ name: 'col1', type: 'varchar' }];
    const rows = [['value']];
    const data = {
      columns,
      rows,
      query: 'SELECT * FROM specific_tab',
      wasTruncated: false,
      totalRowsInFirstBatch: 1,
      queryId: 'query_123',
    };

    resultsViewProvider.showResultsForTab(tabId, data);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'resultData',
      tabId,
      title: 'Query Results',
      data,
    });
  });

  it('should handle empty results', async () => {
    const tabId = 'tab-1';
    resultsViewProvider.createTabWithId(tabId, 'SELECT 1', 'Test Tab');

    const columns = [{ name: 'col1', type: 'varchar' }];
    const rows: any[][] = [];
    const data = {
      columns,
      rows,
      query: 'SELECT * FROM empty_table',
      wasTruncated: false,
      totalRowsInFirstBatch: 0,
      queryId: 'query_123',
    };

    resultsViewProvider.showResults(data);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'resultData',
      tabId,
      title: 'Test Tab',
      data,
    });
  });

  it('should handle error messages', async () => {
    const tabId = 'tab-1';
    resultsViewProvider.createTabWithId(tabId, 'SELECT 1', 'Test Tab');

    const errorMessage = 'Query failed: syntax error';
    const errorDetails = 'line 1:10: Table not found';

    // Pass query and title specifically to match expectations
    resultsViewProvider.showError(errorMessage, errorDetails);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'queryError',
      tabId,
      title: undefined,
      query: undefined,
      error: {
        message: errorMessage,
        details: errorDetails,
      },
    });
  });

  it('should show loading state', async () => {
    const tabId = 'tab-1';
    resultsViewProvider.createTabWithId(tabId, 'SELECT 1', 'Test Tab');

    resultsViewProvider.showLoading();

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'showLoading',
      tabId,
      title: 'Test Tab',
      query: 'SELECT 1',
    });
  });

  it('should show status messages', async () => {
    const message = 'Query completed successfully';

    resultsViewProvider.showStatusMessage(message);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'statusMessage',
      message,
    });
  });

  it('should create a new tab', async () => {
    const query = 'SELECT * FROM new_tab';
    const title = 'New Query Tab';

    resultsViewProvider.createTab(query, title);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'createTab',
        query,
        title,
        sourceFileUri: undefined,
      })
    );
  });

  it('should create a new tab with specific ID', async () => {
    const tabId = 'tab-custom-id';
    const query = 'SELECT * FROM custom_id';
    const title = 'Custom ID Tab';

    resultsViewProvider.createTabWithId(tabId, query, title);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'createTab',
      tabId,
      query,
      title,
      sourceFileUri: undefined,
    });
  });

  it('should get or create active tab ID', async () => {
    const query = 'SELECT * FROM active_tab';
    const title = 'Active Tab';

    const tabId = resultsViewProvider.getOrCreateActiveTabId(query, title);

    expect(tabId).toMatch(/^t[a-z0-9]+/);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'createTab',
        tabId: tabId,
        query,
        title,
      })
    );

    const reusedTabId = resultsViewProvider.getOrCreateActiveTabId(
      'SELECT * FROM reused',
      'Reused Tab'
    );
    expect(reusedTabId).toBe(tabId);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'reuseOrCreateActiveTab',
        query: 'SELECT * FROM reused',
        title: 'Reused Tab',
      })
    );
  });

  it('should close active tab', async () => {
    const tabId = 'tab-1';
    resultsViewProvider.createTabWithId(tabId, 'SELECT 1', 'Test Tab');

    resultsViewProvider.closeActiveTab();

    // closeActiveTab sends closeTab with the active ID
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'closeTab',
      tabId: 'tab-1',
    });

    expect(mockDaemonClient.closeTab).toHaveBeenCalledWith('tab-1');
  });

  it('should close other tabs', async () => {
    resultsViewProvider.createTabWithId('tab-1', 'SELECT 1', 'Test Tab');
    // tab-1 is active

    resultsViewProvider.closeOtherTabs();

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'closeOtherTabs',
    });

    // Should create tabs... wait, closeOtherTabs closes others.
    // We created tab-1. It is active. There are no other tabs.
    // Let's create another tab.
  });

  it('should close other tabs and notify daemon', async () => {
    resultsViewProvider.createTabWithId('tab-1', 'SELECT 1', 'Tab 1');
    resultsViewProvider.createTabWithId('tab-2', 'SELECT 2', 'Tab 2');

    // Capture the message handler from the mock call
    const onDidReceiveMessageMock = mockWebviewPanel.webview.onDidReceiveMessage as jest.Mock;
    // The handler is passed as the first argument in the first call (during resolveWebviewView)
    const messageHandler = onDidReceiveMessageMock.mock.calls[0][0];

    // Make tab-1 active (createTab makes it active, so tab-2 is active now)
    // We want tab-1 to be active?
    await messageHandler({ command: 'tabSelected', tabId: 'tab-1' });

    resultsViewProvider.closeOtherTabs();

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'closeOtherTabs',
    });

    expect(mockDaemonClient.closeTab).toHaveBeenCalledWith('tab-2');
    expect(mockDaemonClient.closeTab).not.toHaveBeenCalledWith('tab-1');
  });

  it('should close all tabs', async () => {
    resultsViewProvider.closeAllTabs();

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'closeAllTabs',
    });

    // closeAllTabs logic
  });

  it('should close all tabs and notify daemon', async () => {
    resultsViewProvider.createTabWithId('tab-1', 'SELECT 1', 'Tab 1');
    resultsViewProvider.createTabWithId('tab-2', 'SELECT 2', 'Tab 2');

    resultsViewProvider.closeAllTabs();

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'closeAllTabs',
    });

    expect(mockDaemonClient.closeTab).toHaveBeenCalledWith('tab-1');
    expect(mockDaemonClient.closeTab).toHaveBeenCalledWith('tab-2');
  });

  it('should create tab with source file URI', () => {
    const sourceUri = 'file:///path/to/script.sql';

    resultsViewProvider.createTabWithId('tab-1', 'SELECT 1', 'Preview', sourceUri);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'createTab',
        tabId: 'tab-1',
        sourceFileUri: sourceUri,
      })
    );
  });

  it('should filter tabs when active editor changes', () => {
    (resultsViewProvider as any).filterTabsByFile('file:///path/to/script.sql');

    // This updates the view, but might not change active tab if there isn't one.
    // However, it sends filterTabs message.
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'filterTabs',
      fileUri: 'file:///path/to/script.sql',
      fileName: 'script.sql',
    });
  });

  it('should decode and filter tabs when active editor has encoded characters', () => {
    (resultsViewProvider as any).filterTabsByFile('file:///path/to/my%20query%20script.sql');

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'filterTabs',
      fileUri: 'file:///path/to/my%20query%20script.sql',
      fileName: 'my query script.sql',
    });
  });

  it('should include context menu in webview HTML', () => {
    // Access the HTML set on the webview
    const html = mockWebviewPanel.webview.html;
    expect(html).toContain('id="tab-context-menu"');
    expect(html).toContain('class="context-menu"');
    expect(html).toContain('id="ctx-copy-query"');
    expect(html).toContain('Copy Query');
  });

  it('should sync remote tabs and filter by session ID', async () => {
    const currentSessionId = 'current-session';
    const otherSessionId = 'other-session';

    const sessions = [
      {
        id: currentSessionId,
        tabs: [{ tabId: 'tab-1', query: 'SELECT 1', status: 'completed' }],
      },
      {
        id: otherSessionId,
        tabs: [{ tabId: 'tab-2', query: 'SELECT 2', status: 'completed' }],
      },
    ];

    resultsViewProvider.syncRemoteTabs(sessions, currentSessionId);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'createTab',
        tabId: 'tab-1',
        title: 'Remote: tab-1',
      })
    );

    expect(mockWebviewPanel.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'createTab',
        tabId: 'tab-2',
      })
    );
  });

  it('should update existing tab status without sending createTab', async () => {
    const currentSessionId = 'current-session';

    // Create tab locally first
    resultsViewProvider.createTabWithId('tab-1', 'SELECT 1', 'Tab 1');
    (mockWebviewPanel.webview.postMessage as jest.Mock).mockClear(); // Clear initial create message

    const sessions = [
      {
        id: currentSessionId,
        tabs: [{ tabId: 'tab-1', query: 'SELECT 1', status: 'success' }],
      },
    ];

    resultsViewProvider.syncRemoteTabs(sessions, currentSessionId);

    // Should NOT send createTab
    expect(mockWebviewPanel.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'createTab',
        tabId: 'tab-1',
      })
    );
  });

  it('should close tab on tabClosed message', async () => {
    resultsViewProvider.createTabWithId('tab-1', 'SELECT 1', 'Tab 1');
    const onDidReceiveMessageMock = mockWebviewPanel.webview.onDidReceiveMessage as jest.Mock;
    const messageHandler = onDidReceiveMessageMock.mock.calls[0][0];

    await messageHandler({ command: 'tabClosed', tabId: 'tab-1' });

    expect(mockDaemonClient.closeTab).toHaveBeenCalledWith('tab-1');
  });
});
