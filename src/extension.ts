import * as vscode from 'vscode';
import { ResultsViewProvider } from './resultsViewProvider';
import { PrestoCodeLensProvider } from './PrestoCodeLensProvider';
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
      .catch(err => Logger.getInstance().error(`Migration error`, err));

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
  daemonStatusBarItem.text = '$(server) SQL Daemon: Info';
  daemonStatusBarItem.command = 'sql.showDaemonInfo';
  context.subscriptions.push(daemonStatusBarItem);
  daemonStatusBarItem.show();

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sql.showDaemonInfo', () => {
      const sessionId = serviceContainer.daemonClient.getSessionId();
      vscode.window.showInformationMessage(`SQL Preview Daemon Active. Session ID: ${sessionId}`);
    }),
    vscode.commands.registerCommand('sql.mcp.restart', async () => {
      // Stop and Start
      await serviceContainer.daemonClient.stop();
      await serviceContainer.daemonClient.start();
      vscode.window.showInformationMessage('Daemon Client Restarted.');
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
      vscode.window.showInformationMessage(
        'Please update ~/.sql-preview/config.json with credentials for Daemon.'
      );
    }),
    vscode.commands.registerCommand('sql.clearPassword', async () => {
      vscode.window.showInformationMessage(
        'Please update ~/.sql-preview/config.json to clear credentials.'
      );
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

  if (activeEditor && activeEditor.document.languageId === 'sql') {
    sourceUri = activeEditor.document.uri.toString();
  } else {
    sourceUri = 'sql-preview:scratchpad';
  }

  const title = 'Result'; // Simplified title generation for now

  let tabId: string;
  if (newTab) {
    tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    resultsViewProvider.createTabWithId(tabId, sql, title, sourceUri);
  } else {
    tabId = resultsViewProvider.getOrCreateActiveTabId(sql, title, sourceUri);
  }

  resultsViewProvider.showLoadingForTab(tabId, sql, title);

  const controller = serviceContainer.querySessionRegistry.createSession(tabId);

  try {
    const contextUri = sourceUri ? vscode.Uri.parse(sourceUri) : undefined;
    const generator = queryExecutor.execute(sql, contextUri, controller.signal);
    let totalRows = 0;
    let columns: import('./common/types').ColumnDef[] = [];
    const allRows: unknown[][] = [];

    const config = vscode.workspace.getConfiguration('sqlPreview');
    const maxRows = config.get<number>('maxRowsToDisplay', 1000);
    let wasTruncated = false;

    for await (const page of generator) {
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
// Prefix unused args with _ to satisfy linter, keeping signature for tests
export function generateTabTitle(sql: string, sourceUri?: string, count = 1): string {
  const config = vscode.workspace.getConfiguration('sqlPreview');
  const naming = config.get<string>('tabNaming', 'file-sequential');

  if (naming === 'query-snippet') {
    return sql.trim().substring(0, 16);
  }

  // file-sequential
  if (sourceUri) {
    return `Result ${count}`;
  }
  return 'Result';
}
