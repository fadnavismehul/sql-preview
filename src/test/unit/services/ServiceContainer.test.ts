import * as vscode from 'vscode';
import { ServiceContainer } from '../../../services/ServiceContainer';

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

  it('should initialize successfully and have empty ConnectorRegistry', () => {
    const container = ServiceContainer.initialize(mockContext);

    expect(container).toBeDefined();

    // Check if the ConnectorRegistry is defined, it should not have Trino statically loaded now
    expect(container.connectorRegistry).toBeDefined();

    // As of RFC-012/RFC-027, Trino is dynamically loaded, so it won't be here statically
    const trinoConnector = container.connectorRegistry.get('trino');
    expect(trinoConnector).toBeUndefined();
  });
});
