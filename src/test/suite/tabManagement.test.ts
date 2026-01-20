import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ResultsViewProvider } from '../../resultsViewProvider';
import { TabManager } from '../../services/TabManager';
import { ExportService } from '../../services/ExportService';
import { QuerySessionRegistry } from '../../services/QuerySessionRegistry';

describe('Tab Management Tests', () => {
  let resultsViewProvider: ResultsViewProvider;
  let mockContext: vscode.ExtensionContext;
  let mockWebviewView: vscode.WebviewView;
  let mockWebview: vscode.Webview;
  let postMessageStub: sinon.SinonStub;

  beforeEach(() => {
    // Create mock extension context
    mockContext = {
      extensionUri: vscode.Uri.file('/mock/extension/path'),
      globalStorageUri: vscode.Uri.file('/mock/storage/path'),
      secrets: {
        get: sinon.stub(),
        store: sinon.stub(),
        delete: sinon.stub(),
      },
      workspaceState: {
        get: sinon.stub(),
        update: sinon.stub(),
      },
      subscriptions: [],
    } as any;

    // Create mock webview
    postMessageStub = sinon.stub();
    mockWebview = {
      postMessage: postMessageStub,
      asWebviewUri: sinon.stub().returns(vscode.Uri.file('/mock/webview/resource')),
      cspSource: 'vscode-resource:',
      html: '',
      onDidReceiveMessage: sinon.stub(),
      options: {},
    } as any;

    // Create mock webview view
    mockWebviewView = {
      webview: mockWebview,
      show: sinon.stub(),
      onDidDispose: sinon.stub(),
    } as any;

    // Create results view provider
    const mockQueryExecutor = {
      executeQuery: sinon.stub(),
      cancelQuery: sinon.stub(),
      runQuery: sinon.stub(),
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
        getConnections: sinon.stub().resolves([]),
        saveConnection: sinon.stub(),
        deleteConnection: sinon.stub(),
      } as any,
      { testConnection: jest.fn() } as any
    );
    resultsViewProvider.resolveWebviewView(mockWebviewView);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Tab Creation and Management', () => {
    test('createTabWithId should create tab with specific ID', () => {
      const tabId = 'test-tab-123';
      const query = 'SELECT * FROM test';
      const title = 'Test Query';

      resultsViewProvider.createTabWithId(tabId, query, title);

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'createTab');
      assert.strictEqual(message.tabId, tabId);
      assert.strictEqual(message.query, query);
      assert.strictEqual(message.title, title);
    });

    test('getOrCreateActiveTabId should request active tab from webview', () => {
      const query = 'SELECT * FROM test';
      const title = 'Test Query';

      // First create a tab to set the active tab ID
      const initialTabId = 'initial-tab';
      resultsViewProvider.createTabWithId(initialTabId, 'SELECT 1', 'Initial');
      postMessageStub.resetHistory(); // Reset stub

      const tabId = resultsViewProvider.getOrCreateActiveTabId(query, title);

      assert.strictEqual(tabId, initialTabId);
      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'reuseOrCreateActiveTab');
      assert.strictEqual(message.query, query);
      assert.strictEqual(message.title, title);
    });

    test('closeActiveTab should send closeActiveTab message', () => {
      resultsViewProvider.createTabWithId('tab-1', 'SELECT 1', 'SELECT 1');
      resultsViewProvider.closeActiveTab();

      // First call is from creation, second from closing. Actually check calls.
      const calls = postMessageStub.getCalls();
      const closeMsg = calls.find((c: any) => c.args[0].type === 'closeTab');

      assert.ok(closeMsg, 'Should send closeTab message');
      assert.strictEqual(closeMsg.args[0].tabId, 'tab-1');
    });

    test('closeOtherTabs should send closeOtherTabs message', () => {
      resultsViewProvider.createTabWithId('tab-1', 'SELECT 1', 'SELECT 1');
      resultsViewProvider.createTabWithId('tab-2', 'SELECT 2', 'SELECT 2');
      resultsViewProvider.closeOtherTabs();

      const calls = postMessageStub.getCalls();
      const closeMsg = calls.find((c: any) => c.args[0].type === 'closeOtherTabs');

      assert.ok(closeMsg, 'Should send closeOtherTabs message');
    });

    test('closeAllTabs should send closeAllTabs message', () => {
      resultsViewProvider.closeAllTabs();

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'closeAllTabs');
    });
  });

  describe('Tab Loading and Results', () => {
    test('showLoadingForTab should show loading for specific tab', () => {
      const tabId = 'test-tab-123';
      const query = 'SELECT * FROM test';
      const title = 'Test Query';

      resultsViewProvider.showLoadingForTab(tabId, query, title);

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'showLoading');
      assert.strictEqual(message.tabId, tabId);
      assert.strictEqual(message.query, query);
      assert.strictEqual(message.title, title);
    });

    test('showResultsForTab should show results for specific tab', () => {
      const tabId = 'test-tab-123';
      const data = {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'varchar' },
        ],
        rows: [
          [1, 'Alice'],
          [2, 'Bob'],
        ],
        query: 'SELECT * FROM users',
        wasTruncated: false,
        totalRowsInFirstBatch: 2,
      };

      resultsViewProvider.showResultsForTab(tabId, data);

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'resultData');
      assert.strictEqual(message.tabId, tabId);
      assert.deepStrictEqual(message.data, data);
    });

    test('showErrorForTab should show error for specific tab', () => {
      const tabId = 'test-tab-123';
      const errorMessage = 'SQL syntax error';
      const errorDetails = 'Line 1: Unexpected token';
      const query = 'SELECT * FROM invalid_table';
      const title = 'Failed Query';

      resultsViewProvider.showErrorForTab(tabId, errorMessage, errorDetails, query, title);

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'queryError');
      assert.strictEqual(message.tabId, tabId);
      assert.strictEqual(message.query, query);
      assert.strictEqual(message.title, title);
      assert.strictEqual(message.error.message, errorMessage);
      assert.strictEqual(message.error.details, errorDetails);
    });
  });

  describe('Webview Interaction', () => {
    test('should handle tab creation without webview gracefully', () => {
      const mockQueryExecutor = {
        executeQuery: sinon.stub(),
        cancelQuery: sinon.stub(),
      } as any;
      const providerWithoutWebview = new ResultsViewProvider(
        mockContext.extensionUri,
        mockContext,
        new TabManager(),
        new ExportService(mockQueryExecutor),
        new QuerySessionRegistry(),
        {
          getConnections: sinon.stub().resolves([]),
          saveConnection: sinon.stub(),
          deleteConnection: sinon.stub(),
        } as any,
        { testConnection: jest.fn() } as any
      );

      // Should not throw
      assert.doesNotThrow(() => {
        providerWithoutWebview.createTabWithId('test', 'SELECT 1', 'Test');
        providerWithoutWebview.closeActiveTab();
        providerWithoutWebview.closeOtherTabs();
        providerWithoutWebview.closeAllTabs();
      });
    });

    test('getOrCreateActiveTabId should return valid tab ID even without webview', () => {
      const mockQueryExecutor = {
        executeQuery: sinon.stub(),
        cancelQuery: sinon.stub(),
      } as any;
      const providerWithoutWebview = new ResultsViewProvider(
        mockContext.extensionUri,
        mockContext,
        new TabManager(),
        new ExportService(mockQueryExecutor),
        new QuerySessionRegistry(),
        {
          getConnections: sinon.stub().resolves([]),
          saveConnection: sinon.stub(),
          deleteConnection: sinon.stub(),
        } as any,
        { testConnection: jest.fn() } as any
      );

      const tabId = providerWithoutWebview.getOrCreateActiveTabId('SELECT 1', 'Test');

      assert.ok(typeof tabId === 'string');
      assert.ok(tabId.length > 0);
      assert.ok(tabId.startsWith('tab-'));
    });
  });
});
