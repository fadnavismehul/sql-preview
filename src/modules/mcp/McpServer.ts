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
import * as http from 'http';
import * as vscode from 'vscode';
import { ResultsViewProvider } from '../../resultsViewProvider';
import { McpToolManager } from './McpToolManager';
import { TabManager } from '../../services/TabManager';

export class SqlPreviewMcpServer {
  private server: Server;
  private app: express.Express;
  private httpServer: http.Server | null | undefined; // Store http server instance to close it later
  private toolManager: McpToolManager;

  constructor(
    resultsProvider: ResultsViewProvider,
    private tabManager: TabManager
  ) {
    this.toolManager = new McpToolManager(resultsProvider, tabManager);

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
      const tabs = this.tabManager.getAllTabs();
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

      const tabData = this.tabManager.getTab(tabId);
      if (!tabData) {
        throw new Error(`Tab not found: ${tabId}`);
      }

      return {
        contents: [
          {
            uri: uri,
            mimeType: 'application/json',
            text: JSON.stringify(tabData, null, 2),
          },
        ],
      };
    });

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.toolManager.getTools(),
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      return this.toolManager.handleToolCall(request.params.name, request.params.arguments);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      } catch (err: unknown) {
        console.error(`Error handling message for session ${sessionId}:`, err);
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).send(message);
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
          this.httpServer = this.app.listen(startPort, '127.0.0.1', () => {
            console.log(`MCP Server listening on port ${startPort} (127.0.0.1)`);
            resolve();
          });
          this.httpServer.on('error', (err: unknown) => {
            reject(err);
          });
        });
        break;
      } catch (err: unknown) {
        // If start failed, ensure we don't hold a reference to a dead server
        this.httpServer = null;

        const code = (err as { code?: string }).code;

        if (code === 'EADDRINUSE') {
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
        this.httpServer?.close((err: unknown) => {
          if (err) {
            // If server is not running, close() throws. We consider this a success (it's stopped).
            const code = (err as { code?: string }).code;
            if (code === 'ERR_SERVER_NOT_RUNNING') {
              resolve();
            } else {
              reject(err);
            }
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
