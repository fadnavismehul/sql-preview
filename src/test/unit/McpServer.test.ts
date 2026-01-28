import { SqlPreviewMcpServer } from '../../modules/mcp/McpServer';
import { ResultsViewProvider } from '../../resultsViewProvider';
import { TabManager } from '../../services/TabManager';
import * as vscode from 'vscode';
import express from 'express';

// Mock dependencies
jest.mock('../../resultsViewProvider');
jest.mock('../../services/TabManager');
jest.mock('../../modules/mcp/McpToolManager');

// Mock SDK
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn(),
  })),
}));
jest.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: jest.fn().mockImplementation(() => ({
    handlePostMessage: jest.fn(),
  })),
}));

// Mock Express
jest.mock('express', () => {
  const mockUse = jest.fn();
  const mockGet = jest.fn();
  const mockPost = jest.fn();
  const mockListen = jest.fn((_p, _h, cb) => {
    if (cb) {
      cb();
    }
    return {
      on: jest.fn(),
      close: jest.fn(cb => cb && cb()),
    };
  });

  const mockApp = {
    use: mockUse,
    get: mockGet,
    post: mockPost,
    listen: mockListen,
  };

  return jest.fn(() => mockApp);
});

describe('SqlPreviewMcpServer', () => {
  let server: SqlPreviewMcpServer;
  let mockResultsProvider: jest.Mocked<ResultsViewProvider>;
  let mockTabManager: jest.Mocked<TabManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResultsProvider = new ResultsViewProvider(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    ) as jest.Mocked<ResultsViewProvider>;
    mockTabManager = new TabManager() as jest.Mocked<TabManager>;
  });

  test('should instantiate correctly', () => {
    server = new SqlPreviewMcpServer(mockResultsProvider, mockTabManager);
    expect(server).toBeDefined();
  });

  test('should start server on configured port and NOT enable CORS', async () => {
    // Mock config
    const mockConfig = {
      get: jest.fn().mockReturnValue(3000),
    };
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig);

    server = new SqlPreviewMcpServer(mockResultsProvider, mockTabManager);
    await server.start();

    // Get the mock app instance
    const app = express();

    expect(app.listen).toHaveBeenCalled();
    expect(server.port).toBe(3000);

    // Verify CORS is NOT used
    expect(app.use).not.toHaveBeenCalled();
  });
});
