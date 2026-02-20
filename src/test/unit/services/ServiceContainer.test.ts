import * as vscode from 'vscode';
import { ServiceContainer } from '../../../services/ServiceContainer';
import { SQLiteConnector } from '../../../connectors/sqlite/SQLiteConnector';

jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn().mockReturnValue({
      get: jest.fn().mockReturnValue('INFO'),
    }),
    onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  },
  window: {
    createOutputChannel: jest.fn().mockReturnValue({
      appendLine: jest.fn(),
      show: jest.fn(),
    }),
    onDidChangeActiveTextEditor: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  },
  EventEmitter: jest.fn().mockImplementation(() => ({
    event: jest.fn(),
    fire: jest.fn(),
  })),
  ExtensionContext: jest.fn(),
}));

describe('ServiceContainer', () => {
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    mockContext = {
      extensionUri: {} as any,
      globalStorageUri: { fsPath: '/test/storage/path' } as any,
      subscriptions: [],
      workspaceState: {
        get: jest.fn().mockReturnValue(undefined),
        update: jest.fn(),
      },
    } as unknown as vscode.ExtensionContext;
  });

  afterEach(() => {
    // Reset singleton if possible, or isolate test since it's a singleton
    (ServiceContainer as any).instance = undefined;
  });

  it('should initialize and contain SQLiteConnector in ConnectorRegistry', () => {
    const container = ServiceContainer.initialize(mockContext);

    expect(container).toBeDefined();

    // Check if the ConnectorRegistry has SQLiteConnector
    const sqliteConnector = container.connectorRegistry.get('sqlite');
    expect(sqliteConnector).toBeDefined();
    expect(sqliteConnector).toBeInstanceOf(SQLiteConnector);
  });
});
