import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
/* eslint-disable no-console */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import cors from 'cors';
import * as vscode from 'vscode';
import { ResultsViewProvider } from './resultsViewProvider';

export class SqlPreviewMcpServer {
  private server: Server;
  private app: express.Express;
  private httpServer: any; // Store http server instance to close it later

  constructor(private resultsProvider: ResultsViewProvider) {
    this.server = new Server(
      {
        name: 'sql-preview-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.app = express();
  }

  private setupHandlers() {
    // List available resources (active tabs)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const tabs = this.resultsProvider.getTabs();
      return {
        resources: tabs.map(tab => ({
          uri: `sql-preview://tabs/${tab.id}`,
          name: tab.title || `Tab ${tab.id}`,
          mimeType: 'application/json',
          description: `SQL Query Results for: ${tab.query}`,
        })),
      };
    });

    // Read a specific resource (tab data)
    this.server.setRequestHandler(ReadResourceRequestSchema, async request => {
      const uri = request.params.uri;
      const tabId = uri.split('/').pop();
      if (!tabId) {
        throw new Error('Invalid resource URI');
      }

      const tabData = this.resultsProvider.getTabData(tabId);
      if (!tabData) {
        throw new Error(`Tab not found: ${tabId}`);
      }

      return {
        contents: [
          {
            uri: uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              tabData,
              (_key, value) => {
                // Basic BigInt handling if any slipped through
                return typeof value === 'bigint' ? value.toString() : value;
              },
              2
            ),
          },
        ],
      };
    });

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
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
        ],
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      switch (request.params.name) {
        case 'run_query': {
          try {
            const args = request.params.arguments as any;
            const sql = args?.sql as string;
            const newTab = args?.newTab !== false; // Default to true

            if (!sql) {
              throw new Error('SQL query is required');
            }

            // Fire and forget
            const commandPromise = newTab
              ? vscode.commands.executeCommand('sql.runQueryNewTab', sql)
              : vscode.commands.executeCommand('sql.runQuery', sql);

            commandPromise.then(
              () => void 0,
              (err: any) => {
                console.error('Failed to trigger query command:', err);
              }
            );

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
        case 'get_active_tab_info': {
          try {
            const args = request.params.arguments as any;
            // timeout in seconds, default to 0 for backward compatibility
            const timeoutSec =
              typeof args?.timeout === 'number' && args.timeout > 0 ? args.timeout : 0;

            const startTime = Date.now();
            const timeoutMs = timeoutSec * 1000;
            const pollInterval = 200; // 200ms

            let activeTabId: string | undefined;
            let tabData: any;

            // Polling loop
            let isDone = false;
            while (!isDone) {
              activeTabId = this.resultsProvider.getActiveTabId();
              if (activeTabId) {
                tabData = this.resultsProvider.getTabData(activeTabId);
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
        default:
          throw new Error('Unknown tool');
      }
    });
  }

  async start() {
    const config = vscode.workspace.getConfiguration('sqlPreview');
    const startPort = config.get<number>('mcpPort', 3000);

    // Track active transports by session ID
    const transports = new Map<string, SSEServerTransport>();

    // DO NOT use global bodyParser.json() if it interferes with SSE stream reading.
    // Instead, we can apply it only to routes that need it, or let the SDK handle it.
    // The MCP SSEServerTransport.handlePostMessage reads the raw request stream.

    this.app.use(cors());

    // Health check / info
    this.app.get('/', (_req, res) => {
      res.send('SQL Preview MCP Server is running.');
    });

    this.app.get('/sse', async (_req, res) => {
      console.log('New SSE connection request');
      const transport = new SSEServerTransport('/messages', res);

      // Store transport by sessionId (exposed in newer SDKs, or we can use the ref)
      // Actually, we can just use the transport's own internal session management
      // but we need to find it again in the POST handler.
      const sessionId = (transport as any)['sessionId'];
      transports.set(sessionId, transport);

      console.log(`SSE session established: ${sessionId}`);

      res.on('close', () => {
        console.log(`SSE session closed: ${sessionId}`);
        transports.delete(sessionId);
      });

      await this.server.connect(transport);
    });

    const handleMessage = async (req: express.Request, res: express.Response) => {
      const sessionId = req.query['sessionId'] as string;
      if (!sessionId) {
        res.status(400).send('Session ID required');
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        console.warn(`Message received for unknown session: ${sessionId}`);
        res.status(404).send('Session not found');
        return;
      }

      try {
        await transport.handlePostMessage(req, res);
      } catch (err: any) {
        console.error(`Error handling message for session ${sessionId}:`, err);
        res.status(500).send(err.message);
      }
    };

    // Main message endpoint
    this.app.post('/messages', handleMessage);

    // Fallback/Redundant endpoint if client is confused (e.g. Cursor POSTing to /sse)
    this.app.post('/sse', handleMessage);

    // Attempt to listen, retrying same port if busy (to allow handover from other window)
    // Retry for up to 30 seconds to handle TIME_WAIT or slow window switching
    let retries = 60;
    while (retries > 0) {
      try {
        await new Promise<void>((resolve, reject) => {
          this.httpServer = this.app.listen(startPort, '0.0.0.0', () => {
            console.log(`MCP Server listening on port ${startPort} (0.0.0.0)`);
            resolve();
          });
          this.httpServer.on('error', (err: any) => {
            reject(err);
          });
        });
        break;
      } catch (err: any) {
        if (err.code === 'EADDRINUSE') {
          // Port busy, wait and retry SAME port to allow other window to release it
          console.log(`Port ${startPort} busy, retrying... (${retries})`);
          await new Promise(r => setTimeout(r, 500));
          retries--;
        } else {
          throw err;
        }
      }
    }

    if (retries === 0) {
      throw new Error(`Could not bind to port ${startPort} after multiple attempts.`);
    }
  }

  async stop() {
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer?.close((err: any) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      this.httpServer = null;
      console.log('MCP Server stopped.');
    }
  }
}
