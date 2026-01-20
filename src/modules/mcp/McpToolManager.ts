import * as vscode from 'vscode';
import { ResultsViewProvider } from '../../resultsViewProvider';
import { TabManager } from '../../services/TabManager';

export class McpToolManager {
  constructor(
    private readonly resultsProvider: ResultsViewProvider,
    private readonly tabManager: TabManager
  ) {}

  public getTools() {
    return [
      {
        name: 'run_query',
        description:
          'Execute a SQL query and show results in a new tab. Note: This tool initiates execution but does not return rows directly. Use get_active_tab_info to view results.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'The SQL query to execute' },
            newTab: {
              type: 'boolean',
              description: 'Whether to open in a new tab (default: true)',
            },
          },
          required: ['sql'],
        },
      },
      {
        name: 'get_active_tab_info',
        description:
          'Get information about the currently active result tab. Supports waiting for completion.',
        inputSchema: {
          type: 'object',
          properties: {
            timeout: {
              type: 'number',
              description:
                'Max seconds to wait for result if status is "loading". Default: 0 (no wait).',
            },
          },
        },
      },
    ];
  }

  public async handleToolCall(name: string, args: any) {
    switch (name) {
      case 'run_query':
        return this.handleRunQuery(args);
      case 'get_active_tab_info':
        return this.handleGetActiveTabInfo(args);
      default:
        throw new Error('Unknown tool');
    }
  }

  private async handleRunQuery(args: any) {
    try {
      const sql = (args?.sql as string)?.trim();
      const newTab = args?.newTab !== false; // Default to true

      if (!sql) {
        throw new Error('SQL query is required');
      }

      // Resolve Context for Configuration
      // Fallback to the last active SQL file known to the provider
      const contextUri = this.resultsProvider.getLastActiveFileUri();

      // Safe Mode Check
      const config = vscode.workspace.getConfiguration('sqlPreview', contextUri);
      const safeMode = config.get<boolean>('mcpSafeMode', true);

      if (safeMode) {
        const safePattern = /^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN|WITH|VALUES)\b/i;
        if (!safePattern.test(sql)) {
          throw new Error(
            'MCP Safe Mode is enabled. Only SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, and VALUES queries are allowed. Disable "sqlPreview.mcpSafeMode" in settings to run other queries.'
          );
        }
      }

      // Fire and forget
      // Fire and forget - Use setTimeout to ensure we return immediately
      setTimeout(() => {
        const commandPromise = newTab
          ? vscode.commands.executeCommand('sql.runQueryNewTab', sql)
          : vscode.commands.executeCommand('sql.runQuery', sql);

        commandPromise.then(
          () => void 0,
          (err: any) => {
            // eslint-disable-next-line no-console
            console.error('Failed to trigger query command:', err);
          }
        );
      }, 10);

      const activeEditor = vscode.window.activeTextEditor;
      const contextFile = activeEditor
        ? activeEditor.document.uri.fsPath.split('/').pop()
        : 'Scratchpad';

      return {
        content: [
          {
            type: 'text',
            text: `Query submitted for execution. Context: ${contextFile}. Results are loading in the SQL Preview panel. Use 'get_active_tab_info' to monitor progress and view results.`,
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error running query: ${error.message}` }],
      };
    }
  }

  private async handleGetActiveTabInfo(args: any) {
    try {
      // timeout in seconds, default to 0 for backward compatibility
      const timeoutSec = typeof args?.timeout === 'number' && args.timeout > 0 ? args.timeout : 0;

      const startTime = Date.now();
      const timeoutMs = timeoutSec * 1000;
      const pollInterval = 200; // 200ms

      let activeTabId: string | undefined;
      let tabData: any;

      // Polling loop
      let isDone = false;
      while (!isDone) {
        activeTabId = this.tabManager.activeTabId;
        if (activeTabId) {
          tabData = this.tabManager.getTab(activeTabId);
          if (tabData) {
            // If status is NOT loading, we are done
            if (tabData.status !== 'loading') {
              isDone = true;
              break;
            }
          }
        }

        // Check if we should wait
        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
          // Timeout reached, return whatever we have
          isDone = true;
          break;
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      if (!activeTabId) {
        return {
          content: [{ type: 'text', text: 'No active tab found.' }],
        };
      }

      if (!tabData) {
        return {
          content: [{ type: 'text', text: 'Active tab data not found.' }],
        };
      }

      // Add sourceFileUri to the response as requested
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: tabData.id,
                title: tabData.title,
                query: tabData.query,
                status: tabData.status,
                rowCount: tabData.rows?.length,
                columns: tabData.columns,
                sourceFile: tabData.sourceFileUri,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error getting active tab info: ${error.message}` }],
      };
    }
  }
}
