import * as vscode from 'vscode';
import { ResultsViewProvider } from './ui/webviews/results/ResultsViewProvider';
import { PrestoCodeLensProvider } from './providers/PrestoCodeLensProvider';
import { getQueryAtOffset } from './utils/querySplitter';
import { ServiceContainer } from './services/ServiceContainer';
import { QueryResults } from './common/types';
import { BaseError } from './common/errors';
import { Logger } from './core/logging/Logger';

// Global instance to allow access in tests/commands if strictly necessary,
// but preferred to access via ServiceContainer.
let serviceContainer: ServiceContainer;

// Status Bar Item
let daemonStatusBarItem: vscode.StatusBarItem;

// Create output channel for logging
export function activate(context: vscode.ExtensionContext) {
  // Validate extension context
  if (!context || !context.extensionUri) {
    Logger.getInstance().error('Invalid extension context or URI during activation');
    vscode.window.showErrorMessage('SQL Preview: Extension failed to activate.');
    return;
  }

  try {
    // Initialize Services (Implicitly initializes Logger)
    serviceContainer = ServiceContainer.initialize(context);

    // Try migrating legacy settings
    // We do this in the background so it doesn't block startup
    serviceContainer.connectionManager
      .migrateLegacySettings()
      .then(() => serviceContainer.connectionManager.sync())
      .catch(err => Logger.getInstance().error(`Migration/Sync error`, err));

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

    Logger.getInstance().info(
      'Successfully registered services, webview provider, and codelens provider'
    );
  } catch (error) {
    // Logger might not be initialized if ServiceContainer failed, so try-catch logger usage?
    // ServiceContainer.initialize initializes Logger FIRST.
    // If ServiceContainer fails before logger, we can't log.
    // But we can fallback console or create one.
    // Assuming ServiceContainer.initialize works partially.
    Logger.getInstance().error(`Service initialization failed`, error);
    vscode.window.showErrorMessage(`SQL Preview: Initialization failed (${error})`);
    return;
  }

  // Initialize Status Bar Item
  daemonStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  daemonStatusBarItem.text = '$(server) SQL Preview Server: Info';
  daemonStatusBarItem.command = 'sql.showDaemonInfo';
  context.subscriptions.push(daemonStatusBarItem);
  daemonStatusBarItem.show();

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sql.showDaemonInfo', () => {
      const sessionId = serviceContainer.daemonClient.getSessionId();
      vscode.window.showInformationMessage(`SQL Preview Server Active. Session ID: ${sessionId}`);
    }),
    vscode.commands.registerCommand('sql.mcp.restart', async () => {
      // Stop and Start
      await serviceContainer.daemonClient.stop();
      await serviceContainer.daemonClient.start();
      vscode.window.showInformationMessage('SQL Preview Client Restarted.');
    }),
    vscode.commands.registerCommand('sql.debug.resetSession', async () => {
      await context.workspaceState.update('sqlPreview.sessionId', undefined);
      const choice = await vscode.window.showInformationMessage(
        'Session ID cleared. Reload window to start a fresh session?',
        'Reload',
        'Later'
      );
      if (choice === 'Reload') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    })
  );

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
      const manager = serviceContainer.connectionManager;
      const connections = await manager.getConnections();
      let profileId: string;

      // Ensure at least one profile exists
      if (connections.length === 0) {
        profileId = 'default-' + Date.now();
        // Create minimal default profile
        const defaultProfile: any = {
          id: profileId,
          name: 'Default Connection',
          type: 'trino', // Default
          host: 'localhost',
          port: 8080,
          user: 'user',
        };
        await manager.saveConnection(defaultProfile);
      } else {
        profileId = connections[0]!.id;
      }

      const password = await vscode.window.showInputBox({
        prompt: 'Enter Database Password',
        password: true,
        placeHolder: 'Password will be stored securely in VS Code Secret Storage',
      });

      if (password !== undefined && password.length > 0) {
        await manager.updatePassword(profileId, password);
        vscode.window.showInformationMessage('Password saved securely.');
      }
    }),
    vscode.commands.registerCommand('sql.clearPassword', async () => {
      const manager = serviceContainer.connectionManager;
      const connections = await manager.getConnections();
      if (connections.length > 0) {
        await manager.clearPasswordForConnection(connections[0]!.id);
        vscode.window.showInformationMessage('Credentials cleared.');
      } else {
        vscode.window.showInformationMessage('No credentials found to clear.');
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

  // Check configuration for "Run in New Tab" preference
  const config = vscode.workspace.getConfiguration('sqlPreview');
  const alwaysNewTab = config.get<boolean>('alwaysRunInNewTab', false);

  // If config is true, force new tab unless explicitly handled otherwise (though currently runQueryNewTab passes true anyway)
  // We only override false -> true.
  if (alwaysNewTab && !newTab) {
    newTab = true;
  }

  // Determine target Tab ID
  const activeEditor = vscode.window.activeTextEditor;
  let sourceUri: string | undefined;

  if (activeEditor && activeEditor.document.languageId === 'sql') {
    sourceUri = activeEditor.document.uri.toString();
  } else {
    sourceUri = 'sql-preview:scratchpad';
  }

  // Generate title based on tab naming settings
  const count = resultsViewProvider.getMaxResultCountForFile(sourceUri) + 1;
  const title = generateTabTitle(sql, sourceUri, count);

  let tabId: string;
  if (newTab) {
    tabId = `t${Math.random().toString(36).substring(2, 10)}`;
    resultsViewProvider.createTabWithId(tabId, sql, title, sourceUri);
  } else {
    tabId = resultsViewProvider.getOrCreateActiveTabId(sql, title, sourceUri);
  }

  resultsViewProvider.showLoadingForTab(tabId, sql, title);

  const controller = serviceContainer.querySessionRegistry.createSession(tabId);

  try {
    const contextUri = sourceUri ? vscode.Uri.parse(sourceUri) : undefined;
    const generator = queryExecutor.execute(sql, contextUri, controller.signal, tabId);
    let totalRows = 0;
    let columns: import('./common/types').ColumnDef[] = [];
    const allRows: unknown[][] = [];

    const config = vscode.workspace.getConfiguration('sqlPreview');
    const maxRows = config.get<number>('maxRowsToDisplay', 1000);
    let wasTruncated = false;

    for await (const page of generator) {
      if (page.remoteTabId) {
        // Link local tab to remote tab to prevent duplicates in sync
        Logger.getInstance().info(
          `[Extension] Linking local tab ${tabId} to remote tab ${page.remoteTabId}`
        );
        resultsViewProvider.updateTab(tabId, { remoteId: page.remoteTabId });
      }

      if (page.columns) {
        columns = page.columns;
      }
      if (page.data) {
        const CHUNK_SIZE = 10000;
        for (let i = 0; i < page.data.length; i += CHUNK_SIZE) {
          allRows.push(...page.data.slice(i, i + CHUNK_SIZE));
        }
        totalRows += page.data.length;
      }

      if (allRows.length >= maxRows) {
        wasTruncated = true;
        // Abort the session to stop any in-flight daemon requests
        controller.abort();
        break;
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    // Check for safe errors if needed and extract details, ignoring BaseError check to silence linter
    let details: string | undefined;
    if (error instanceof BaseError) {
      details = error.details;
    }

    resultsViewProvider.showErrorForTab(tabId, message, details, sql, title);
  } finally {
    serviceContainer.querySessionRegistry.clearSession(tabId);
  }
}

export function deactivate() {
  if (serviceContainer && serviceContainer.daemonClient) {
    serviceContainer.daemonClient.stop();
  }
}

// Prefix unused args with _ to satisfy linter, keeping signature for tests
export function generateTabTitle(sql: string, sourceUri?: string, count = 1): string {
  const config = vscode.workspace.getConfiguration('sqlPreview');
  const naming = config.get<string>('tabNaming', 'file-sequential');

  if (naming === 'query-snippet') {
    // Clean up SQL: remove newlines and extra whitespace
    const cleanSql = sql.trim().replace(/\s+/g, ' ');
    // Take first 30 characters and add ellipsis if truncated
    return cleanSql.length > 30 ? cleanSql.substring(0, 30) + '...' : cleanSql;
  }

  // file-sequential
  if (sourceUri) {
    return `Result ${count}`;
  }
  return 'Result';
}
