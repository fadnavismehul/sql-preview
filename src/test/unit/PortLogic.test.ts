import * as vscode from 'vscode';
import { ResultsHtmlGenerator } from '../../ui/webviews/results/ResultsHtmlGenerator';

// Mock dependencies
const mockExtensionUri = vscode.Uri.file('/mock/extension');
const mockWebview = {
  asWebviewUri: jest.fn((uri: vscode.Uri) => uri),
  cspSource: 'mock-csp-source',
} as unknown as vscode.Webview;

// Mock vscode configuration
const mockConfigGet = jest.fn();
jest.mock(
  'vscode',
  () => ({
    Uri: {
      file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
      joinPath: (...args: any[]) => ({
        fsPath: args.join('/'),
        scheme: 'file',
        path: args.join('/'),
      }),
    },
    workspace: {
      getConfiguration: jest.fn(() => ({
        get: mockConfigGet,
      })),
    },
    Webview: jest.fn(),
  }),
  { virtual: true }
);

describe('Port Logic Validation', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    mockConfigGet.mockImplementation((_key: string, defaultValue: any) => defaultValue);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('ResultsHtmlGenerator Port Resolution', () => {
    it('should default to port 8414 when no env var is present', () => {
      delete process.env['SQL_PREVIEW_MCP_PORT'];
      const generator = new ResultsHtmlGenerator(mockExtensionUri);
      const html = generator.getHtmlForWebview(mockWebview);

      // Check for default port in JSON snippet
      expect(html).toContain('"url": "http://127.0.0.1:8414/mcp"');
      // Check for default port in label
      expect(html).toContain('<strong id="mcp-port-label">8414</strong>');
    });

    it('should use SQL_PREVIEW_MCP_PORT env var if present', () => {
      process.env['SQL_PREVIEW_MCP_PORT'] = '9999';
      const generator = new ResultsHtmlGenerator(mockExtensionUri);
      const html = generator.getHtmlForWebview(mockWebview);

      // Check for env port
      expect(html).toContain('"url": "http://127.0.0.1:9999/mcp"');
      expect(html).toContain('<strong id="mcp-port-label">9999</strong>');
    });

    it('should IGNORE vscode configuration even if set', () => {
      delete process.env['SQL_PREVIEW_MCP_PORT'];
      // Simulate user config set to 3000
      mockConfigGet.mockImplementation((key: string, defaultValue: any) => {
        if (key === 'mcpPort') {
          return 3000;
        }
        return defaultValue;
      });

      const generator = new ResultsHtmlGenerator(mockExtensionUri);
      const html = generator.getHtmlForWebview(mockWebview);

      // Should STILL be 8414, ignoring the 3000 from config
      expect(html).toContain('"url": "http://127.0.0.1:8414/mcp"');
      expect(html).toContain('<strong id="mcp-port-label">8414</strong>');
      expect(html).not.toContain('3000');
    });
  });
});
