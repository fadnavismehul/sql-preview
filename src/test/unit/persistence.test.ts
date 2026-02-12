import * as vscode from 'vscode';
import { ResultsViewProvider } from '../../ui/webviews/results/ResultsViewProvider';
import { QuerySessionRegistry } from '../../services/QuerySessionRegistry';
import { TabManager } from '../../services/TabManager';
import { ExportService } from '../../services/ExportService';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import '../setup';

describe('ResultsViewProvider Persistence', () => {
  let provider: ResultsViewProvider;
  let mockContext: any;
  let mockWebview: any;
  let mockStorageUri: any;

  beforeEach(() => {
    mockStorageUri = {
      fsPath: '/mock/storage',
      scheme: 'file',
      toString: () => 'file:///mock/storage',
    };
    mockContext = {
      extensionUri: { fsPath: '/mock/extension' },
      globalStorageUri: mockStorageUri,
      subscriptions: [],
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
      },
    };

    mockWebview = {
      webview: {
        options: {},
        html: '',
        onDidReceiveMessage: jest.fn(),
        postMessage: jest.fn(),
        asWebviewUri: jest.fn((uri: any) => uri),
      },
      visible: true,
      onDidDispose: jest.fn(),
      onDidChangeVisibility: jest.fn(),
    };

    // Reset mocks
    (vscode.workspace.fs.writeFile as jest.Mock).mockClear();
    (vscode.workspace.fs.readFile as jest.Mock).mockClear();
    (vscode.workspace.fs.createDirectory as jest.Mock).mockClear();

    const mockQueryExecutor = {
      executeQuery: jest.fn(),
      cancelQuery: jest.fn(),
    } as any;

    const tabManager = new TabManager();
    const exportService = new ExportService(mockQueryExecutor);
    const querySessionRegistry = new QuerySessionRegistry();

    provider = new ResultsViewProvider(
      mockContext.extensionUri,
      mockContext,
      tabManager,
      exportService,
      querySessionRegistry,
      {
        getConnections: jest.fn().mockReturnValue(Promise.resolve([])),
        saveConnection: jest.fn(),
        deleteConnection: jest.fn(),
      } as any,
      { testConnection: jest.fn() } as any,
      { closeTab: jest.fn().mockReturnValue(Promise.resolve()) } as any // Mock DaemonClient
    );
  });

  it('should save state when a tab is created', async () => {
    // Simulate resolving webview to set up the view
    provider.resolveWebviewView(mockWebview);

    // Create a tab
    provider.createTabWithId('tab-1', 'SELECT 1', 'SELECT 1');

    // Check if writeFile was called
    // Check if workspaceState usage
    expect(mockContext.workspaceState.update).toHaveBeenCalled();
    const callArgs = mockContext.workspaceState.update.mock.calls[0];
    const key = callArgs[0];
    const value = callArgs[1];

    expect(key).toBe('sqlPreview.state');
    expect(value).toBeDefined();

    const savedData = value;
    expect(savedData.tabs).toBeDefined();
    expect(Array.isArray(savedData.tabs)).toBe(true);
    expect(savedData.tabs.length).toBe(1);
    expect(savedData.tabs[0][1].id).toBe('tab-1');
  });

  it('should load state on initialization', async () => {
    // Mock existing state file
    const mockState = {
      tabs: [
        [
          'tab-old',
          { id: 'tab-old', query: 'SELECT old', title: 'Old Query', status: 'success', rows: [] },
        ],
      ],
      resultCounter: 5,
    };

    (mockContext.workspaceState.get as jest.Mock).mockReturnValue(mockState);

    // Re-initialize provider to trigger loadState
    const mockQueryExecutor = {
      executeQuery: jest.fn(),
      cancelQuery: jest.fn(),
    } as any;
    const tabManager = new TabManager();
    const exportService = new ExportService(mockQueryExecutor);
    const querySessionRegistry = new QuerySessionRegistry();

    provider = new ResultsViewProvider(
      mockContext.extensionUri,
      mockContext,
      tabManager,
      exportService,
      querySessionRegistry,
      {
        getConnections: jest.fn().mockReturnValue(Promise.resolve([])),
        saveConnection: jest.fn(),
        deleteConnection: jest.fn(),
      } as any,
      { testConnection: jest.fn() } as any,
      { closeTab: jest.fn().mockReturnValue(Promise.resolve()) } as any // Mock DaemonClient
    );

    // Wait for async loadState
    await new Promise(resolve => setTimeout(resolve, 100));

    provider.resolveWebviewView(mockWebview);

    // Simulate webview loaded message
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const messageHandler = (mockWebview.webview.onDidReceiveMessage as jest.Mock).mock
      .calls[0]![0] as (msg: unknown) => void;
    messageHandler({ command: 'webviewLoaded' });

    // Check if restore messages were sent
    expect(mockWebview.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'createTab',
        tabId: 'tab-old',
      })
    );
  });

  it('should update state when results are shown', async () => {
    provider.resolveWebviewView(mockWebview);
    provider.createTabWithId('tab-1', 'SELECT 1', 'SELECT 1');

    // Clear previous write calls
    (mockContext.workspaceState.update as jest.Mock).mockClear();

    provider.showResultsForTab('tab-1', {
      columns: [{ name: 'id', type: 'integer' }],
      rows: [[1]],
      query: 'SELECT 1',
      wasTruncated: false,
      totalRowsInFirstBatch: 1,
    });

    expect(mockContext.workspaceState.update).toHaveBeenCalled();
    const callArgs = (mockContext.workspaceState.update as jest.Mock).mock.calls[0] as any[];
    const value = callArgs[1] as any;

    expect(value.tabs).toBeDefined();
    // Implementation detail: we save tab data.
    // Check if correct tab is updated.
    const savedTabs = new Map(value.tabs);
    const tabData = savedTabs.get('tab-1') as any;
    expect(tabData.status).toBe('success');
    expect(tabData.rows.length).toBe(0); // Rows are cleared for persistence
  });
});
