import * as vscode from 'vscode';
import { ResultsViewProvider } from './resultsViewProvider';
import { SqlPreviewMcpServer } from './mcpServer';
import { PrestoCodeLensProvider } from './PrestoCodeLensProvider';
import { getQueryAtOffset } from './utils/querySplitter';
import { AuthManager } from './services/AuthManager';
import { QueryExecutor } from './services/QueryExecutor';
import { QueryResults } from './common/types';

let resultsViewProvider: ResultsViewProvider | undefined;
let mcpServer: SqlPreviewMcpServer | undefined;
let authManager: AuthManager | undefined;
let queryExecutor: QueryExecutor | undefined;

// Create output channel for logging
const outputChannel = vscode.window.createOutputChannel('SQL Preview');

// Status Bar Item
let mcpStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Validate extension context
  if (!context || !context.extensionUri) {
    outputChannel.appendLine('ERROR: Invalid extension context or URI during activation');
    vscode.window.showErrorMessage('SQL Preview: Extension failed to activate.');
    return;
  }

  try {
    // Initialize Services
    authManager = new AuthManager(context);
    queryExecutor = new QueryExecutor(authManager);
    resultsViewProvider = new ResultsViewProvider(context.extensionUri, context, queryExecutor);

    // Register Webview Provider
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ResultsViewProvider.viewType, resultsViewProvider)
    );

    // Register CodeLens Provider
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
        { language: 'sql', scheme: 'file' },
        new PrestoCodeLensProvider()
      )
    );

    outputChannel.appendLine(
      'Successfully registered services, webview provider, and codelens provider'
    );
  } catch (error) {
    outputChannel.appendLine(`ERROR: Service initialization failed: ${error}`);
    vscode.window.showErrorMessage(`SQL Preview: Initialization failed (${error})`);
    return;
  }

  // Initialize Status Bar Item
  mcpStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  mcpStatusBarItem.command = 'sql.showMcpInfo';
  context.subscriptions.push(mcpStatusBarItem);

  // Helper to start MCP Server
  const startMcpServer = async () => {
    if (!resultsViewProvider) {
      return;
    }

    const config = vscode.workspace.getConfiguration('sqlPreview');
    if (!config.get<boolean>('mcpEnabled', false)) {
      mcpStatusBarItem.hide();
      return;
    }

    if (mcpServer) {
      await mcpServer.stop();
      mcpServer = undefined;
    }

    outputChannel.appendLine('Initializing MCP Server...');
    try {
      mcpServer = new SqlPreviewMcpServer(resultsViewProvider);
      await mcpServer.start();
      mcpStatusBarItem.text = `$(server) MCP Active`;
      mcpStatusBarItem.show();
    } catch (err) {
      // If start failed (e.g. port still busy after retries), we notify user
      outputChannel.appendLine(`ERROR: Failed to start MCP Server: ${err}`);
      mcpStatusBarItem.text = `$(error) MCP Port Busy`;
      mcpStatusBarItem.show();
      mcpServer = undefined;

      vscode.window
        .showErrorMessage(
          'SQL Preview MCP Server could not bind to port 3000. Do you have the production extension running? Please disable it.',
          'Retry'
        )
        .then(sel => {
          if (sel === 'Retry') {
            startMcpServer();
          }
        });
    }
  };

  const stopMcpServer = async () => {
    if (mcpServer) {
      await mcpServer.stop();
      mcpServer = undefined;
    }
    mcpStatusBarItem.hide();
  };

  // Manual Toggle Commands for Reliable Handover
  context.subscriptions.push(
    vscode.commands.registerCommand('sql.showMcpInfo', () => {
      vscode.commands.executeCommand('sql.mcp.toggle');
    }),
    vscode.commands.registerCommand('sql.mcp.toggle', async () => {
      if (mcpServer) {
        await stopMcpServer();
        vscode.window.showInformationMessage('MCP Server Stopped (Port Released).');
        mcpStatusBarItem.text = '$(circle-slash) MCP Inactive';
        mcpStatusBarItem.tooltip = 'Click to Start MCP Server';
        mcpStatusBarItem.show();
      } else {
        await startMcpServer();
      }
    }),
    vscode.commands.registerCommand('sql.mcp.start', async () => {
      await startMcpServer();
    }),
    vscode.commands.registerCommand('sql.mcp.stop', async () => {
      await stopMcpServer();
    })
  );

  startMcpServer();

  // SQL Execution Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sql.runQuery', (sql?: string) =>
      handleQueryCommand(sql, false)
    ),
    vscode.commands.registerCommand('sql.runQueryNewTab', (sql?: string) =>
      handleQueryCommand(sql, true)
    ),
    vscode.commands.registerCommand('sql.runCursorQuery', (sql?: string) =>
      handleQueryCommand(sql, false)
    )
  );

  // Tab Management Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sql.closeTab', (tabId?: string) => {
      if (tabId) {
        resultsViewProvider?.closeTab(tabId);
      } else {
        resultsViewProvider?.closeActiveTab();
      }
    }),
    vscode.commands.registerCommand('sql.exportFullResults', () => {
      resultsViewProvider?.exportFullResults();
    }),
    vscode.commands.registerCommand('sql.closeOtherTabs', () => {
      resultsViewProvider?.closeOtherTabs();
    }),
    vscode.commands.registerCommand('sql.closeAllTabs', () => {
      resultsViewProvider?.closeAllTabs();
    })
  );

  // Auth/Password Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sql.setPassword', async () => {
      const password = await vscode.window.showInputBox({
        prompt: 'Enter your database password',
        password: true,
      });
      if (password !== undefined) {
        if (password === '') {
          await authManager?.clearPassword();
          vscode.window.showInformationMessage('Database password cleared.');
        } else {
          await authManager?.setPassword(password);
          vscode.window.showInformationMessage('Database password stored securely.');
        }
      }
    }),
    vscode.commands.registerCommand('sql.clearPassword', async () => {
      await authManager?.clearPassword();
      vscode.window.showInformationMessage('Database password cleared.');
    }),
    vscode.commands.registerCommand('sql.setPasswordFromSettings', async () => {
      const password = await vscode.window.showInputBox({
        prompt: 'Enter your database password',
        password: true,
      });
      if (password !== undefined) {
        await authManager?.setPassword(password);
        vscode.window.showInformationMessage('Database password stored securely.');
      }
    })
  );

  // Focus-Based Handover Listener
  // When we gain focus, we aggressively try to take the port.
  // We NEVER stop on blur.
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(async state => {
      const config = vscode.workspace.getConfiguration('sqlPreview');
      const autoHandover = config.get<boolean>('mcpAutoHandover', true);
      const enabled = config.get<boolean>('mcpEnabled', false);

      if (enabled && autoHandover && state.focused) {
        // Focus Gained: Request Port ownership
        await startMcpServer();
      }
    })
  );
}

async function handleQueryCommand(sqlFromCodeLens: string | undefined, newTab: boolean) {
  if (!resultsViewProvider || !queryExecutor) {
    vscode.window.showErrorMessage('SQL Preview services not initialized.');
    return;
  }

  let sql = sqlFromCodeLens;
  if (!sql) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active SQL editor.');
      return;
    }
    const selection = editor.selection;
    if (!selection.isEmpty) {
      sql = editor.document.getText(selection);
    } else {
      // Find query at cursor
      const text = editor.document.getText();
      const offset = editor.document.offsetAt(selection.active);
      const found = getQueryAtOffset(text, offset);
      if (found) {
        sql = found;
      } else {
        vscode.window.showInformationMessage('No SQL query found at cursor.');
        return;
      }
    }
  }

  if (!sql || !sql.trim()) {
    return;
  }

  sql = sql.trim().replace(/;$/, '');

  // Determine target Tab ID
  const activeEditor = vscode.window.activeTextEditor;
  let sourceUri: string | undefined;

  // 1. If active editor is a SQL file, attach results to it.
  if (activeEditor && activeEditor.document.languageId === 'sql') {
    sourceUri = activeEditor.document.uri.toString();
  } else {
    // 2. If non-SQL (Markdown, etc) or no editor, use the Scratchpad.
    // This prevents polluting non-SQL files with results.
    sourceUri = 'sql-preview:scratchpad';
  }

  // Simple title generation
  const title = sourceUri
    ? `Result ${resultsViewProvider.getMaxResultCountForFile(sourceUri) + 1}`
    : 'Result';

  let tabId: string;
  if (newTab) {
    tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    resultsViewProvider.createTabWithId(tabId, sql, title, sourceUri);
  } else {
    tabId = resultsViewProvider.getOrCreateActiveTabId(sql, title, sourceUri);
  }

  resultsViewProvider.showLoadingForTab(tabId, sql, title);

  try {
    const generator = queryExecutor.execute(sql);
    let totalRows = 0;
    let columns: any[] = [];
    const allRows: any[] = [];

    for await (const page of generator) {
      if (page.columns) {
        columns = page.columns;
      }
      if (page.data) {
        allRows.push(...page.data);
        totalRows += page.data.length;
      }
    }

    const results: QueryResults = {
      columns: columns,
      rows: allRows,
      query: sql,
      wasTruncated: false,
      totalRowsInFirstBatch: totalRows,
    };

    resultsViewProvider.showResultsForTab(tabId, results);
  } catch (error: any) {
    resultsViewProvider.showErrorForTab(tabId, error.message, error.stack, sql, title);
  }
}

export function deactivate() {
  if (mcpServer) {
    mcpServer.stop();
  }
}
