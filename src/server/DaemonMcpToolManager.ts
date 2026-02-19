import { SessionManager } from './SessionManager';
import { DaemonQueryExecutor } from './DaemonQueryExecutor';
import { ConnectionManager } from './connection/ConnectionManager';
import { TabData } from '../common/types';
import { logger } from './ConsoleLogger';

export class DaemonMcpToolManager {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly queryExecutor: DaemonQueryExecutor,
    private readonly connectionManager: ConnectionManager
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
            connectionId: {
              type: 'string',
              description:
                'Optional Connection ID to use a specific stored connection. Use list_connections to find available IDs.',
            },
            connectionProfile: {
              type: 'object',
              description:
                'Optional ad-hoc connection profile (including credentials) to use for this query.',
            },
            waitForResult: {
              type: 'boolean',
              description:
                'Whether to wait for the query to complete and return results (default: false)',
            },
            tabId: {
              type: 'string',
              description:
                'Optional Tab ID to use for the result. If provided, the daemon will use this ID instead of generating a new one.',
            },
          },
          required: ['sql', 'session'],
        },
        _meta: {
          ui: {
            resourceUri: 'ui://sql-preview/results-grid',
          },
        },
      },
      {
        name: 'get_tab_info',
        description:
          'Get information about a result tab in a session. Defaults to a "preview" mode with metadata and a small sample. Use mode="page" to retrieve full pages of rows.',
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
            mode: {
              type: 'string',
              enum: ['preview', 'page'],
              description:
                'Retrieval mode. "preview" (default) returns stats + 10 rows. "page" returns specific rows defined by offset/limit.',
            },
            offset: {
              type: 'number',
              description: 'Row offset for "page" mode (default: 0)',
            },
            limit: {
              type: 'number',
              description:
                'Number of rows to return. Default: 100 for "page" mode, 10 for "preview" mode.',
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
        name: 'list_connections',
        description:
          'List available database connections managed by the daemon. Returns connection IDs and metadata (excluding passwords).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'save_connection',
        description: 'Save or update a connection profile.',
        inputSchema: {
          type: 'object',
          properties: {
            connectionProfile: {
              type: 'object',
              description: 'The connection profile to save (must include "id", "name", "type").',
            },
          },
          required: ['connectionProfile'],
        },
      },
      {
        name: 'test_connection',
        description: 'Test connectivity for a specific connection profile.',
        inputSchema: {
          type: 'object',
          properties: {
            connectionId: {
              type: 'string',
              description: 'The Connection ID to test.',
            },
          },
          required: ['connectionId'],
        },
      },
      {
        name: 'delete_connection',
        description: 'Delete a connection profile.',
        inputSchema: {
          type: 'object',
          properties: {
            connectionId: {
              type: 'string',
              description: 'The Connection ID to delete.',
            },
          },
          required: ['connectionId'],
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
      /*
      {
        name: 'close_tab',
        description: 'Close a tab and remove it from the session.',
        inputSchema: {
          type: 'object',
          properties: {
            session: { type: 'string', description: 'The Session ID' },
            tabId: { type: 'string', description: 'The Tab ID to close' },
          },
          required: ['session', 'tabId'],
        },
      },
      */
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
      case 'list_connections':
        return this.handleListConnections();
      case 'save_connection':
        return this.handleSaveConnection(args);
      case 'test_connection':
        return this.handleTestConnection(args);
      case 'delete_connection':
        return this.handleDeleteConnection(args);
      case 'cancel_query':
        return this.handleCancelQuery(args);
      case 'close_tab':
        return this.handleCloseTab(args);
      default:
        throw new Error('Unknown tool');
    }
  }

  private async handleCloseTab(args: unknown) {
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

    this.sessionManager.removeTab(sessionId, tabId);
    session.lastActivityAt = new Date();

    return {
      content: [{ type: 'text', text: `Tab ${tabId} closed` }],
    };
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
        logger.info(`Aborting query for tab ${tabId}`);
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
              tabs: Array.from(s.tabs.values()).map(t => ({
                tabId: t.id,
                title: t.title,
                status: t.status,
                query: t.query,
              })),
            })),
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleListConnections() {
    const connections = await this.connectionManager.getProfiles();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            connections.map(c => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { password, ...safeProfile } = c as any;
              return safeProfile;
            }),
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleSaveConnection(args: unknown) {
    const typedArgs = args as { connectionProfile?: any } | undefined;
    const profile = typedArgs?.connectionProfile;

    if (!profile || !profile.id || !profile.name || !profile.type) {
      throw new Error('Invalid connection profile: missing id, name, or type');
    }

    // Delegate to ConnectionManager
    await this.connectionManager.saveProfile(profile);

    return {
      content: [{ type: 'text', text: `Connection '${profile.id}' saved.` }],
    };
  }

  private async handleTestConnection(args: unknown) {
    const typedArgs = args as { connectionId?: string } | undefined;
    const connectionId = typedArgs?.connectionId;

    if (!connectionId) {
      throw new Error('Connection ID required');
    }

    const profile = await this.connectionManager.getProfile(connectionId);
    if (!profile) {
      throw new Error(`Connection profile '${connectionId}' not found`);
    }

    // Construct Config & Auth similar to runQuery logic
    // We should probably share this logic, but for now duplicate
    const connectorConfig: any = {
      ...profile,
      maxRows: 1,
      sslVerify: 'sslVerify' in profile ? profile.sslVerify : true,
    };

    let authHeader: string | undefined;
    if ('password' in profile && profile.password && 'user' in profile && profile.user) {
      authHeader = 'Basic ' + Buffer.from(`${profile.user}:${profile.password}`).toString('base64');
    }

    // Call Executor Test
    // Using 'any' cast on executor because testConnection might not be public in interface?
    // It IS public in class.
    const result = await this.queryExecutor.testConnection(
      profile.type,
      connectorConfig,
      authHeader
    );

    if (result.success) {
      return {
        content: [{ type: 'text', text: 'Connection Test Successful' }],
      };
    } else {
      return {
        isError: true,
        content: [{ type: 'text', text: `Connection Test Failed: ${result.error}` }],
      };
    }
  }

  private async handleDeleteConnection(args: unknown) {
    const typedArgs = args as { connectionId?: string } | undefined;
    const connectionId = typedArgs?.connectionId;

    if (!connectionId) {
      throw new Error('Connection ID required');
    }

    try {
      await this.connectionManager.deleteProfile(connectionId);
      return {
        content: [{ type: 'text', text: `Connection '${connectionId}' deleted.` }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to delete connection '${connectionId}': ${msg}`);
    }
  }

  private async handleRunQuery(args: unknown) {
    try {
      const typedArgs = args as
        | {
            sql?: string;
            session?: string;
            displayName?: string;
            newTab?: boolean;
            connectionId?: string;
            connectionProfile?: unknown;
            tabId?: string;
            waitForResult?: boolean;
          }
        | undefined;
      const sql = typedArgs?.sql?.trim();
      // Default to a known session ID if not provided (e.g. from Inspector or App)
      const sessionId = typedArgs?.session || 'default-session';
      const displayName = typedArgs?.displayName || 'MCP Client';
      const connectionId = typedArgs?.connectionId;
      const connectionProfile = typedArgs?.connectionProfile;
      const providedTabId = typedArgs?.tabId;
      const waitForResult = typedArgs?.waitForResult === true;

      if (!sql) {
        throw new Error('SQL query is required');
      }
      // Session ID is now guaranteed
      // if (!sessionId) {
      //   throw new Error('Session ID is required');
      // }

      // Lazy session registration: auto-create if not found
      let session = this.sessionManager.getSession(sessionId);
      if (!session) {
        logger.info('Session not found, auto-registering...');
        this.sessionManager.registerSession(sessionId, displayName, 'standalone');
        session = this.sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Failed to auto-register session: ${sessionId}`);
        }
      }

      // 3. Determine Tab
      const shouldCreateNewTab = typedArgs?.newTab !== false; // Default to true
      let tabId: string;
      let tabTitle: string;
      let tab: TabData | undefined;

      if (providedTabId) {
        // Use provided Tab ID
        tabId = providedTabId;
        tab = session.tabs.get(tabId);

        if (tab) {
          // Reset existing tab if it was already there (weird case but possible)
          tab.status = 'loading';
          tab.query = sql;
          tab.rows = [];
          tab.columns = [];
          tab.error = undefined;
          tabTitle = tab.title;
        } else {
          // Create new with this ID
          tabTitle = `Result ${session.tabs.size + 1}`;
        }
      } else if (!shouldCreateNewTab && session.activeTabId) {
        // Reuse existing active tab
        tabId = session.activeTabId;
        tab = session.tabs.get(tabId);
        if (tab) {
          // Reset tab state for new query
          tab.status = 'loading';
          tab.query = sql;
          tab.rows = [];
          tab.columns = [];
          tab.error = undefined;
          tabTitle = tab.title; // Keep existing title
        } else {
          // Fallback if active tab ID is stale
          tabId = `t${Math.random().toString(36).substring(2, 10)}`;
          tabTitle = `Result ${session.tabs.size + 1}`;
        }
      } else {
        // Create New with generated ID
        tabId = `t${Math.random().toString(36).substring(2, 10)}`;
        tabTitle = `Result ${session.tabs.size + 1}`;
      }

      if (!tab) {
        tab = {
          id: tabId,
          title: tabTitle,
          query: sql,
          columns: [],
          rows: [],
          status: 'loading',
        };
        this.sessionManager.addTab(sessionId, tab);
      } else {
        // Just update existing
        this.sessionManager.updateTab(sessionId, tabId, {
          status: 'loading',
          query: sql,
          rows: [],
          columns: [],
          error: undefined,
        });
      }

      session.activeTabId = tabId;
      session.lastActivityAt = new Date();

      // Start Execution
      const controller = new AbortController();
      session.abortControllers.set(tabId, controller);

      const executionPromise = this.executeAndStore(
        sessionId,
        tabId,
        sql,
        connectionId,
        connectionProfile,
        controller.signal
      ).finally(() => {
        session.abortControllers.delete(tabId);
      });

      if (waitForResult) {
        await executionPromise;

        // Re-fetch tab to get results
        const updatedTab = session.tabs.get(tabId);
        const rowCount = updatedTab?.rows?.length ?? 0;

        return {
          content: [
            {
              type: 'text',
              text: `Query returned ${rowCount} rows`,
            },
          ],
          data: {
            query: sql,
            columns: updatedTab?.columns || [],
            rows: updatedTab?.rows || [],
            rowCount: rowCount,
            executionTime: 0,
            connection: connectionId || 'default',
          },
        };
      } else {
        // Fire and forget (Extension behavior)
        // Ensure we catch errors in background to avoid unhandled rejections
        executionPromise.catch(err => {
          logger.error('[Daemon] Background query execution error:', err);
        });

        return {
          content: [
            {
              type: 'text',
              text: `Query started. Tab ID: ${tabId}`,
            },
          ],
        };
      }
    } catch (error: unknown) {
      logger.error('Error inside handleRunQuery:', error);
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
    connectionId?: string,
    connectionProfile?: unknown,
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
        connectionId,
        signal,
        connectionProfile as import('../common/types').ConnectionProfile
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
          this.sessionManager.updateTab(sessionId, tabId, {
            columns: page.columns ? page.columns : tab.columns,
            rows: page.data && page.data.length > 0 ? [...tab.rows, ...page.data] : tab.rows,
            status: 'loading',
          });
        }
        if (page.supportsPagination !== undefined) {
          tab.supportsPagination = page.supportsPagination;
        }
        // Update status to keep UI alive/informed?
        // Actually 'loading' is fine until done.
      }

      this.sessionManager.updateTab(sessionId, tabId, {
        status: 'success',
        totalRowsInFirstBatch: tab.rows.length,
      });
      tab.totalRowsInFirstBatch = tab.rows.length;
    } catch (err) {
      this.sessionManager.updateTab(sessionId, tabId, {
        status: 'error',
        error: signal?.aborted
          ? 'Query cancelled by user'
          : err instanceof Error
            ? err.message
            : String(err),
      });
    }
  }

  private async handleGetTabInfo(args: unknown) {
    const typedArgs = args as
      | {
          session?: string;
          tabId?: string;
          mode?: 'preview' | 'page';
          offset?: number;
          limit?: number;
        }
      | undefined;
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

    const mode = typedArgs?.mode || 'preview';
    const totalRows = tab.rows?.length ?? 0;
    const resourceUri = `sql-preview://sessions/${sessionId}/tabs/${tabId}`;

    if (mode === 'preview') {
      // Smart Summary Mode
      const previewLimit = typedArgs?.limit || 10;
      const previewRows = tab.rows ? tab.rows.slice(0, previewLimit) : [];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: tab.status,
                meta: {
                  totalRows: totalRows,
                  columns: tab.columns,
                },
                preview: previewRows,
                message: `Showing ${previewRows.length} of ${totalRows} rows. Use mode='page' for pagination or read_resource for full data.`,
                resourceUri: resourceUri,
                error: tab.error,
              },
              null,
              2
            ),
          },
        ],
      };
    } else {
      // Page Mode (Legacy / Explicit Fetch)
      const offset = typedArgs?.offset || 0;
      const limit = typedArgs?.limit ?? 100;
      const rows = tab.rows ? tab.rows.slice(offset, offset + limit) : [];
      const hasMore = offset + rows.length < totalRows;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: tab.id,
                title: tab.title,
                status: tab.status,
                meta: {
                  totalRows: totalRows,
                  columns: tab.columns,
                },
                rows: rows,
                offset: offset,
                limit: limit,
                hasMore: hasMore,
                resourceUri: resourceUri,
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
}
