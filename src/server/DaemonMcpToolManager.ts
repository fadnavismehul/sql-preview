import { SessionManager } from './SessionManager';
import { DaemonQueryExecutor } from './DaemonQueryExecutor';
import { TabData } from '../common/types';

export class DaemonMcpToolManager {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly queryExecutor: DaemonQueryExecutor
  ) {}

  public getTools() {
    return [
      {
        name: 'run_query',
        description:
          'Execute a SQL query for a specific session. Returns a tab ID immediately; use get_tab_info to check status and retrieve results. If the session does not exist, it will be auto-registered.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'The SQL query to execute' },
            session: {
              type: 'string',
              description:
                'The Session ID to run this query in. Use list_sessions to discover existing sessions, or provide a new ID to auto-create a session.',
            },
            displayName: {
              type: 'string',
              description:
                'Display name for a new session (only used when auto-registering). Defaults to "MCP Client".',
            },
            newTab: {
              type: 'boolean',
              description: 'Whether to open in a new tab (default: true)',
            },
            connectionProfile: {
              type: 'object',
              description: 'Optional connection profile override (includes credentials)',
            },
          },
          required: ['sql', 'session'],
        },
      },
      {
        name: 'get_tab_info',
        description:
          'Get information about a result tab in a session, including query status and result rows. Use this after run_query to check if execution completed and retrieve data.',
        inputSchema: {
          type: 'object',
          properties: {
            session: {
              type: 'string',
              description: 'The Session ID. Use list_sessions to discover available sessions.',
            },
            tabId: {
              type: 'string',
              description:
                'The Tab ID to retrieve (optional, defaults to the most recently active tab in the session)',
            },
            offset: {
              type: 'number',
              description: 'Optional row offset to fetch from (for pagination)',
            },
          },
          required: ['session'],
        },
      },
      {
        name: 'list_sessions',
        description:
          'List all active sessions managed by the daemon. Use this first to discover existing session IDs before running queries or checking results.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'cancel_query',
        description:
          'Cancel a running query. Use get_tab_info first to check if a query is still in "loading" state before cancelling.',
        inputSchema: {
          type: 'object',
          properties: {
            session: { type: 'string', description: 'The Session ID' },
            tabId: { type: 'string', description: 'The Tab ID to cancel' },
          },
          required: ['session', 'tabId'],
        },
      },
    ];
  }

  public async handleToolCall(name: string, args: unknown) {
    switch (name) {
      case 'run_query':
        return this.handleRunQuery(args);
      case 'get_tab_info':
        return this.handleGetTabInfo(args);
      case 'list_sessions':
        return this.handleListSessions();
      case 'cancel_query':
        return this.handleCancelQuery(args);
      default:
        throw new Error('Unknown tool');
    }
  }

  private async handleCancelQuery(args: unknown) {
    const typedArgs = args as { session?: string; tabId?: string } | undefined;
    const sessionId = typedArgs?.session;
    const tabId = typedArgs?.tabId;

    if (!sessionId || !tabId) {
      throw new Error('Session ID and Tab ID required');
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const tab = session.tabs.get(tabId);
    if (tab) {
      tab.status = 'error';
      tab.error = 'Query cancelled by user';

      // Abort execution
      const controller = session.abortControllers.get(tabId);
      if (controller) {
        console.log(`Aborting query for tab ${tabId}`);
        controller.abort();
      }
    }

    return {
      content: [{ type: 'text', text: `Query cancelled for tab ${tabId}` }],
    };
  }

  private handleListSessions() {
    const sessions = this.sessionManager.getAllSessions();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            sessions.map(s => ({
              id: s.id,
              displayName: s.displayName,
              clientType: s.clientType,
            })),
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleRunQuery(args: unknown) {
    try {
      const typedArgs = args as
        | {
            sql?: string;
            session?: string;
            displayName?: string;
            newTab?: boolean;
            connectionProfile?: any;
          }
        | undefined;
      const sql = typedArgs?.sql?.trim();
      const sessionId = typedArgs?.session;
      const displayName = typedArgs?.displayName || 'MCP Client';
      const connectionProfile = typedArgs?.connectionProfile;

      if (!sql) {
        throw new Error('SQL query is required');
      }
      if (!sessionId) {
        throw new Error('Session ID is required');
      }

      // Lazy session registration: auto-create if not found
      let session = this.sessionManager.getSession(sessionId);
      if (!session) {
        this.sessionManager.registerSession(sessionId, displayName, 'standalone');
        session = this.sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Failed to auto-register session: ${sessionId}`);
        }
      }

      // Create Tab
      const tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const tabTitle = `Result ${session.tabs.size + 1}`;

      const tab: TabData = {
        id: tabId,
        title: tabTitle,
        query: sql,
        columns: [],
        rows: [],
        status: 'loading',
      };

      session.tabs.set(tabId, tab);
      session.activeTabId = tabId;
      session.lastActivityAt = new Date();

      // Start Execution in Background
      const controller = new AbortController();
      session.abortControllers.set(tabId, controller);

      this.executeAndStore(sessionId, tabId, sql, connectionProfile, controller.signal).finally(
        () => {
          session.abortControllers.delete(tabId);
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: `Query submitted to Session '${session.displayName}'. Tab ID: ${tabId}. Status: Loading.`,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: `Error running query: ${message}` }],
      };
    }
  }

  private async executeAndStore(
    sessionId: string,
    tabId: string,
    sql: string,
    connectionProfile?: any,
    signal?: AbortSignal
  ) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return;
    }

    const tab = session.tabs.get(tabId);
    if (!tab) {
      return;
    }

    try {
      const generator = this.queryExecutor.execute(
        sql,
        sessionId,
        undefined,
        signal,
        connectionProfile
      );

      let columns: import('../common/types').ColumnDef[] = [];

      // Ensure rows is initialized
      if (!tab.rows) {
        tab.rows = [];
      }

      for await (const page of generator) {
        if (page.columns) {
          columns = page.columns;
          tab.columns = columns;
        }
        if (page.data && page.data.length > 0) {
          tab.rows.push(...page.data);
        }
        // Update status to keep UI alive/informed?
        // Actually 'loading' is fine until done.
      }

      tab.status = 'success';
      tab.totalRowsInFirstBatch = tab.rows.length;
    } catch (err) {
      tab.status = 'error';
      // Check if aborted
      if (signal?.aborted) {
        tab.error = 'Query cancelled by user';
      } else {
        tab.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  private async handleGetTabInfo(args: unknown) {
    const typedArgs = args as { session?: string; tabId?: string; offset?: number } | undefined;
    const sessionId = typedArgs?.session;
    if (!sessionId) {
      throw new Error('Session ID required');
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const tabId = typedArgs?.tabId || session.activeTabId;
    if (!tabId) {
      return { content: [{ type: 'text', text: 'No active tab in session.' }] };
    }

    const tab = session.tabs.get(tabId);
    if (!tab) {
      return { content: [{ type: 'text', text: 'Tab not found.' }] };
    }

    const offset = typedArgs?.offset || 0;
    const rows = tab.rows ? tab.rows.slice(offset) : [];

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              id: tab.id,
              title: tab.title,
              status: tab.status,
              rowCount: tab.rows?.length,
              columns: tab.columns,
              rows: rows,
              error: tab.error,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
