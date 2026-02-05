import * as vscode from 'vscode';
import { mockWebviewPanel } from '../setup';
import { ResultsViewProvider } from '../../ui/webviews/results/ResultsViewProvider';
import { TabManager } from '../../services/TabManager';
import { ExportService } from '../../services/ExportService';
// import { QuerySessionRegistry } from '../../services/QuerySessionRegistry';
import axios from 'axios';
import * as path from 'path';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ResultsViewInteraction Tests', () => {
  let resultsViewProvider: ResultsViewProvider;
  let mockWebviewView: any;
  let mockQueryExecutor: any;
  let mockTabManager: TabManager;
  let mockQuerySessionRegistry: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock axios
    mockedAxios.post.mockResolvedValue({
      data: { results: [] },
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
      extensionUri: vscode.Uri.file(path.resolve(__dirname, '../../..')),
      globalStorageUri: vscode.Uri.file('/mock/storage/path'),
      workspaceState: {
        get: jest.fn().mockReturnValue(undefined),
        update: jest.fn(),
      },
      subscriptions: [],
      globalState: {
        get: jest.fn(),
        update: jest.fn(),
      },
    } as any;

    mockQueryExecutor = {
      executeQuery: jest.fn(),
      cancelQuery: jest.fn(),
    } as any;

    mockTabManager = new TabManager();
    const exportService = new ExportService(mockQueryExecutor);

    mockQuerySessionRegistry = {
      registerSession: jest.fn(),
      getSession: jest.fn(),
      cancelSession: jest.fn(),
    };

    resultsViewProvider = new ResultsViewProvider(
      mockContext.extensionUri,
      mockContext,
      mockTabManager,
      exportService,
      mockQuerySessionRegistry as any, // Mocked registry
      {
        getConnections: jest.fn().mockResolvedValue([]),
        saveConnection: jest.fn(),
        deleteConnection: jest.fn(),
        testConnection: jest.fn(),
      } as any,
      mockQueryExecutor
    );

    resultsViewProvider.resolveWebviewView(mockWebviewView);
  });

  it('should handle cancelQuery command from webview', async () => {
    // Setup handler access
    const onDidReceiveMessageMock = mockWebviewView.webview.onDidReceiveMessage as jest.Mock;
    const messageHandler = onDidReceiveMessageMock.mock.calls[0][0];

    const tabId = 'tab-1';

    // Simulate webview sending cancelQuery
    await messageHandler({ command: 'cancelQuery', tabId });

    // Verify QuerySessionRegistry.cancelSession was called
    // The handler calls this._querySessionRegistry.cancelSession(data.tabId)
    expect(mockQuerySessionRegistry.cancelSession).toHaveBeenCalledWith(tabId);
  });

  it('should show loading state correctly for a tab', async () => {
    const tabId = 'tab-new';
    const query = 'SELECT * FROM test';

    // Create tab first
    resultsViewProvider.createTabWithId(tabId, query, 'New Tab');

    // Call explicitly showLoadingForTab
    resultsViewProvider.showLoadingForTab(tabId, query, 'New Tab');

    // Verify messages
    const calls = mockWebviewPanel.webview.postMessage.mock.calls;

    // Should find a message with type: 'createTab'
    const createMsg = calls.find((c: any[]) => c[0].type === 'createTab');
    expect(createMsg).toBeDefined();

    // Should find message with type: 'showLoading'
    const loadingMsg = calls.find((c: any[]) => c[0].type === 'showLoading');
    expect(loadingMsg).toBeDefined();
    expect(loadingMsg[0].tabId).toBe(tabId);
  });

  it('should update tab with result data', async () => {
    const tabId = 'tab-result';
    const data = {
      columns: [{ name: 'id', type: 'int' }],
      rows: [[1]],
      query: 'SELECT 1',
      queryId: 'q1',
      wasTruncated: false,
      totalRowsInFirstBatch: 1,
      infoUri: undefined,
      nextUri: undefined,
    };

    // Create tab first to have it in manager
    resultsViewProvider.createTabWithId(tabId, 'SELECT 1', 'Result Tab');

    // Show results
    resultsViewProvider.showResultsForTab(tabId, data);

    const calls = mockWebviewPanel.webview.postMessage.mock.calls;
    const resultMsg = calls.find((c: any[]) => c[0].type === 'resultData');

    expect(resultMsg).toBeDefined();
    expect(resultMsg[0].tabId).toBe(tabId);
    expect(resultMsg[0].data).toEqual(data);
  });
});
