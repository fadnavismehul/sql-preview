import * as vscode from 'vscode';
import { ResultsViewProvider } from './resultsViewProvider';
import { SqlPreviewMcpServer } from './mcpServer';
import { PrestoCodeLensProvider } from './PrestoCodeLensProvider';
import { getQueryAtOffset } from './utils/querySplitter';
import { ServiceContainer } from './services/ServiceContainer';
import { QueryResults } from './common/types';

// Global instance to allow access in tests/commands if strictly necessary,
// but preferred to access via ServiceContainer unless legacy.
let serviceContainer: ServiceContainer;
let mcpServer: SqlPreviewMcpServer | undefined;
// Status Bar Item
let mcpStatusBarItem: vscode.StatusBarItem;

// Create output channel for logging
const outputChannel = vscode.window.createOutputChannel('SQL Preview');

export function activate(context: vscode.ExtensionContext) {
  // Validate extension context
  if (!context || !context.extensionUri) {
    outputChannel.appendLine('ERROR: Invalid extension context or URI during activation');
    vscode.window.showErrorMessage('SQL Preview: Extension failed to activate.');
    return;
  }

  try {
    // Initialize Services via ServiceContainer
    serviceContainer = ServiceContainer.initialize(context);

    // Register Webview Provider
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        ResultsViewProvider.viewType,
        serviceContainer.resultsViewProvider
      )
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
    // We access dependencies through the container
    const provider = serviceContainer.resultsViewProvider;
    if (!provider) {
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
      mcpServer = new SqlPreviewMcpServer(provider);
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
        serviceContainer.resultsViewProvider.closeTab(tabId);
      } else {
        serviceContainer.resultsViewProvider.closeActiveTab();
      }
    }),
    vscode.commands.registerCommand('sql.exportFullResults', () => {
      serviceContainer.resultsViewProvider.exportFullResults();
    }),
    vscode.commands.registerCommand('sql.closeOtherTabs', () => {
      serviceContainer.resultsViewProvider.closeOtherTabs();
    }),
    vscode.commands.registerCommand('sql.closeAllTabs', () => {
      serviceContainer.resultsViewProvider.closeAllTabs();
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
          await serviceContainer.authManager.clearPassword();
          vscode.window.showInformationMessage('Database password cleared.');
        } else {
          await serviceContainer.authManager.setPassword(password);
          vscode.window.showInformationMessage('Database password stored securely.');
        }
      }
    }),
    vscode.commands.registerCommand('sql.clearPassword', async () => {
      await serviceContainer.authManager.clearPassword();
      vscode.window.showInformationMessage('Database password cleared.');
    }),
    vscode.commands.registerCommand('sql.setPasswordFromSettings', async () => {
      const password = await vscode.window.showInputBox({
        prompt: 'Enter your database password',
        password: true,
      });
      if (password !== undefined) {
        await serviceContainer.authManager.setPassword(password);
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
  if (!serviceContainer) {
    vscode.window.showErrorMessage('SQL Preview services not initialized.');
    return;
  }

  const resultsViewProvider = serviceContainer.resultsViewProvider;
  const queryExecutor = serviceContainer.queryExecutor;

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

  // Determine Title based on Configuration
  const nextCount = sourceUri ? resultsViewProvider.getMaxResultCountForFile(sourceUri) + 1 : 1;
  const title = generateTabTitle(sql, sourceUri, nextCount);

  let tabId: string;
  if (newTab) {
    tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    resultsViewProvider.createTabWithId(tabId, sql, title, sourceUri);
  } else {
    // This calls getOrCreateActiveTabId, which now uses TabManager internally
    tabId = resultsViewProvider.getOrCreateActiveTabId(sql, title, sourceUri);
  }

  resultsViewProvider.showLoadingForTab(tabId, sql, title);

  try {
    const generator = queryExecutor.execute(sql);
    let totalRows = 0;
    let columns: any[] = [];
    const allRows: any[] = [];

    const config = vscode.workspace.getConfiguration('sqlPreview');
    const maxRows = config.get<number>('maxRowsToDisplay', 1000);
    let wasTruncated = false;

    for await (const page of generator) {
      if (page.columns) {
        columns = page.columns;
      }
      if (page.data) {
        allRows.push(...page.data);
        totalRows += page.data.length;
      }

      if (allRows.length >= maxRows) {
        // Truncate to exact limit if needed, though pushing page chunks is slightly more efficient
        // We'll just stop here.
        wasTruncated = true;
        break; // Stop fetching
      }
    }

    const results: QueryResults = {
      columns: columns,
      rows: allRows,
      query: sql,
      wasTruncated: wasTruncated,
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

/**
 * Generates a title for the results tab based on configuration.
 * Exported for testing.
 */
export function generateTabTitle(
  sql: string,
  sourceUri: string | undefined,
  nextCount: number
): string {
  const config = vscode.workspace.getConfiguration('sqlPreview');
  const contextNaming = config.get<string>('tabNaming', 'file-sequential');

  if (contextNaming === 'query-snippet') {
    const snippet = sql.replace(/\s+/g, ' ').substring(0, 16).trim();
    return snippet || 'Query';
  } else {
    return sourceUri ? `Result ${nextCount}` : 'Result';
  }
}
