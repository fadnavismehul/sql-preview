import * as vscode from 'vscode';
import { ResultsHtmlGenerator } from '../../ui/webviews/results/ResultsHtmlGenerator';

describe('ResultsHtmlGenerator', () => {
  let generator: ResultsHtmlGenerator;
  let mockWebview: vscode.Webview;
  const extensionUri = vscode.Uri.file('/mock/extension');

  beforeEach(() => {
    mockWebview = {
      asWebviewUri: jest.fn((uri: vscode.Uri) => uri),
      cspSource: 'mock-csp-source',
    } as unknown as vscode.Webview;

    generator = new ResultsHtmlGenerator(extensionUri);
  });

  it('should generate valid HTML structure', () => {
    const html = generator.getHtmlForWebview(mockWebview);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>SQL Preview Results</title>');
  });

  it('should include correct Clear button class', () => {
    // We expect class="danger-button" NOT "danger-button small"
    const html = generator.getHtmlForWebview(mockWebview);

    // Check Set button
    expect(html).toContain('<button id="set-password-btn" class="primary-button">Set</button>');

    // Check Clear button - Ensure it does NOT have 'small' class
    expect(html).toContain('<button id="clear-password-btn" class="danger-button">Clear</button>');
    expect(html).not.toContain(
      '<button id="clear-password-btn" class="danger-button small">Clear</button>'
    );
  });

  it('should include correct MCP snippet', () => {
    const html = generator.getHtmlForWebview(mockWebview);

    // Check for "streamable-http" and full JSON object structure
    expect(html).toContain('"sql-preview": {');
    expect(html).toContain('"type": "streamable-http"');
    expect(html).toContain('"url": "http://localhost:8414/mcp"');
  });

  it('should include necessary scripts and styles', () => {
    const html = generator.getHtmlForWebview(mockWebview);

    expect(html).toContain('ag-grid-community.min.js');
    expect(html).toContain('ag-grid.min.css');
    expect(html).toContain('resultsView.js');
    expect(html).toContain('resultsView.css');
  });
});
