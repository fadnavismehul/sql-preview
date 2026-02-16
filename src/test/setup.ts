// import * as vscode from 'vscode'; // Currently unused in this file

// Mock VS Code API
const mockWebviewPanel = {
  webview: {
    html: '',
    postMessage: jest.fn(),
    onDidReceiveMessage: jest.fn(),
    asWebviewUri: jest.fn(uri => uri),
    options: {},
  },
  onDidDispose: jest.fn(),
  reveal: jest.fn(),
  dispose: jest.fn(),
};

const mockWorkspaceConfig = {
  get: jest.fn(),
  update: jest.fn(),
  has: jest.fn(),
};

const mockContext = {
  subscriptions: [],
  workspaceState: {
    get: jest.fn(),
    update: jest.fn(),
  },
  globalState: {
    get: jest.fn(),
    update: jest.fn(),
  },
  secrets: {
    get: jest.fn(),
    store: jest.fn(),
    delete: jest.fn(),
  },
  extensionPath: '/mock/extension/path',
  extensionUri: { fsPath: '/mock/extension/path', path: '/mock/extension/path' },
  asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
};

// Mock VS Code namespace
jest.mock(
  'vscode',
  () => ({
    commands: {
      registerCommand: jest.fn(),
      executeCommand: jest.fn(),
    },
    window: {
      createWebviewPanel: jest.fn(() => mockWebviewPanel),
      registerWebviewViewProvider: jest.fn(),
      showInformationMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      showInputBox: jest.fn(),
      activeTextEditor: undefined,
      showSaveDialog: jest.fn(),
      withProgress: jest.fn(),
      createOutputChannel: jest.fn(() => ({
        appendLine: jest.fn(),
        show: jest.fn(),
        clear: jest.fn(),
        dispose: jest.fn(),
      })),
      createStatusBarItem: jest.fn(() => ({
        text: '',
        tooltip: '',
        command: '',
        show: jest.fn(),
        hide: jest.fn(),
        dispose: jest.fn(),
      })),
      onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
      onDidChangeWindowState: jest.fn(() => ({ dispose: jest.fn() })),
    },
    languages: {
      registerCodeLensProvider: jest.fn(),
    },
    workspace: {
      getConfiguration: jest.fn(() => mockWorkspaceConfig),
      workspaceFolders: [],
      getWorkspaceFolder: jest.fn(),
      onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
      fs: {
        createDirectory: jest.fn().mockResolvedValue(undefined as never),
        writeFile: jest.fn().mockResolvedValue(undefined as never),
        readFile: jest.fn().mockResolvedValue(Buffer.from('{}') as never),
      },
    },
    ProgressLocation: {
      SourceControl: 1,
      Window: 10,
      Notification: 15,
    },
    EventEmitter: class {
      private _listeners: Array<(e: unknown) => unknown> = [];
      get event() {
        return (listener: (e: unknown) => unknown) => {
          this._listeners.push(listener);
          return {
            dispose: () => {
              /* no-op */
            },
          };
        };
      }
      fire(data: unknown) {
        this._listeners.forEach(l => l(data));
      }
    },
    Uri: {
      file: jest.fn(path => ({ fsPath: path, path })),
      parse: jest.fn(),
      joinPath: jest.fn((base, ...paths) => ({
        fsPath: `${base.fsPath}/${paths.join('/')}`,
        path: `${base.path}/${paths.join('/')}`,
        toString: () => `${base.toString()}/${paths.join('/')}`,
      })),
    },
    ViewColumn: {
      One: 1,
      Two: 2,
    },
    Position: jest.fn().mockImplementation((line, character) => ({ line, character })),
    Range: jest.fn().mockImplementation((start, end) => ({ start, end })),
    CodeLens: jest.fn().mockImplementation((range, command) => ({ range, command })),
    StatusBarAlignment: {
      Left: 1,
      Right: 2,
    },
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3,
    },
  }),
  { virtual: true }
);

// Mock trino-client
jest.mock('trino-client', () => ({
  Trino: {
    create: jest.fn(),
  },
  BasicAuth: jest.fn(),
  Client: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
    execute: jest.fn(),
  })),
}));

// Mock sqlite3
jest.mock(
  'sqlite3',
  () => ({
    Database: jest.fn(),
    OPEN_READWRITE: 1,
    OPEN_CREATE: 2,
  }),
  { virtual: true }
);

// Mock pg
jest.mock('pg', () => ({
  Client: jest.fn(),
  Pool: jest.fn(),
}));

// Mock axios
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(),
}));

// Mock fs module for filesystem operations
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true), // Default to true for tests
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// Export mocks for use in tests
export { mockWebviewPanel, mockWorkspaceConfig, mockContext };
