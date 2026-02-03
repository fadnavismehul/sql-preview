import * as vscode from 'vscode';

import { mockWebviewPanel, mockWorkspaceConfig } from '../setup';
import { ResultsViewProvider } from '../../ui/webviews/results/ResultsViewProvider';
import { TabManager } from '../../services/TabManager';
import { ExportService } from '../../services/ExportService';
import { QuerySessionRegistry } from '../../services/QuerySessionRegistry';

describe('ResultsViewProvider Connection Tests', () => {
  let resultsViewProvider: ResultsViewProvider;
  let mockWebviewView: any;
  let mockQueryExecutor: any;
  let onDidReceiveMessageMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockWebviewView = {
      webview: mockWebviewPanel.webview,
      show: jest.fn(),
      onDidDispose: jest.fn(),
    };
    onDidReceiveMessageMock = mockWebviewPanel.webview.onDidReceiveMessage as jest.Mock;

    const mockContext = {
      extensionUri: vscode.Uri.file('/mock'),
      subscriptions: [],
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
      },
      secrets: {
        get: jest.fn().mockResolvedValue(undefined), // No password
      },
    } as any;

    mockQueryExecutor = {
      testConnection: jest.fn().mockResolvedValue({ success: true }),
    };

    resultsViewProvider = new ResultsViewProvider(
      vscode.Uri.file('/mock'),
      mockContext,
      new TabManager(),
      new ExportService(mockQueryExecutor),
      new QuerySessionRegistry(),
      { getConnections: jest.fn().mockResolvedValue([]) } as any, // mockConnectionManager
      mockQueryExecutor
    );

    resultsViewProvider.resolveWebviewView(mockWebviewView);
  });

  it('testConnection should respect configured connector type', async () => {
    // 1. Setup Config to be SQLite
    mockWorkspaceConfig.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'defaultConnector') {
        return 'sqlite';
      }
      return defaultValue;
    });

    // 2. Trigger message
    const messageHandler = onDidReceiveMessageMock.mock.calls[0][0];
    await messageHandler({
      command: 'testConnection',
      config: {
        databasePath: '/tmp/db.sqlite',
      },
    });

    // 3. Assert QueryExecutor called with 'sqlite'
    expect(mockQueryExecutor.testConnection).toHaveBeenCalledWith(
      'sqlite',
      expect.objectContaining({ databasePath: '/tmp/db.sqlite' }),
      undefined
    );
  });

  it('testConnection defaults to trino if configured', async () => {
    // 1. Setup Config to be Trino
    mockWorkspaceConfig.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'defaultConnector') {
        return 'trino';
      }
      return defaultValue;
    });

    // 2. Trigger message
    const messageHandler = onDidReceiveMessageMock.mock.calls[0][0];
    await messageHandler({
      command: 'testConnection',
      config: {
        host: 'localhost',
        port: 8080,
        user: 'admin',
      },
    });

    // 3. Assert QueryExecutor called with 'trino'
    expect(mockQueryExecutor.testConnection).toHaveBeenCalledWith(
      'trino',
      expect.objectContaining({ host: 'localhost' }),
      undefined
    );
  });

  it('testConnection should use defaultConnector provided in payload (override)', async () => {
    // 1. Setup Config to be Trino (default)
    mockWorkspaceConfig.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'defaultConnector') {
        return 'trino';
      }
      return defaultValue;
    });

    // 2. Trigger message with SQLite override
    const messageHandler = onDidReceiveMessageMock.mock.calls[0][0];
    await messageHandler({
      command: 'testConnection',
      config: {
        databasePath: '/tmp/db.sqlite',
        defaultConnector: 'sqlite',
      },
    });

    // 3. Assert QueryExecutor called with 'sqlite' despite config saying 'trino'
    expect(mockQueryExecutor.testConnection).toHaveBeenCalledWith(
      'sqlite',
      expect.objectContaining({ databasePath: '/tmp/db.sqlite' }),
      undefined
    );
  });
});
