import express from 'express';
import * as http from 'http';
import * as crypto from 'crypto';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { SocketTransport } from './SocketTransport';
import { WebSocketServerTransport } from './WebSocketServerTransport';
import * as WebSocket from 'ws';
import { SessionManager } from './SessionManager';
import { ConnectionManager } from './connection/ConnectionManager';
import { FileProfileStore } from './connection/FileProfileStore';
import { EnvProfileStore } from './connection/EnvProfileStore';
import { MemoryCredentialStore } from './connection/MemoryCredentialStore';
import { DaemonQueryExecutor } from './DaemonQueryExecutor';
import { DaemonMcpToolManager } from './DaemonMcpToolManager';
import { DaemonMcpServer } from './DaemonMcpServer';
import { ConnectorRegistry } from '../connectors/base/ConnectorRegistry';
import { DriverManager } from '../services/DriverManager';

import { logger, ConsoleLogger } from './ConsoleLogger';

export class Daemon {
  private app: express.Express;
  private httpServer: http.Server | null = null;
  private socketServer: net.Server | null = null;
  private wss: WebSocket.Server | null = null;
  private toolManager: DaemonMcpToolManager;
  private mcpSessions = new Map<
    string,
    {
      server: Server;
      transport: StreamableHTTPServerTransport;
      lastActive: number;
    }
  >();

  private sessionManager: SessionManager;
  private connectionManager: ConnectionManager;
  private connectorRegistry: ConnectorRegistry;
  private queryExecutor: DaemonQueryExecutor;

  private readonly HTTP_PORT: number;
  private readonly SOCKET_PATH: string;
  private readonly CONFIG_DIR: string;

  constructor() {
    this.app = express();

    // Check for port override
    this.HTTP_PORT = process.env['MCP_PORT'] ? parseInt(process.env['MCP_PORT'], 10) : 8414;

    // Determine Config Dir
    const homeDir = os.homedir();
    this.CONFIG_DIR = process.env['SQL_PREVIEW_HOME'] || path.join(homeDir, '.sql-preview');

    if (!fs.existsSync(this.CONFIG_DIR)) {
      fs.mkdirSync(this.CONFIG_DIR, { recursive: true });
    }
    this.SOCKET_PATH = path.join(this.CONFIG_DIR, `srv-${this.HTTP_PORT}.sock`);

    // 1. Initialize Managers
    this.sessionManager = new SessionManager(ConsoleLogger.getInstance());

    const fileStore = new FileProfileStore(this.CONFIG_DIR);
    const envStore = new EnvProfileStore();
    const credStore = new MemoryCredentialStore();
    // Env Store (index 0) has highest priority in our ConnectionManager implementation?
    // Wait, ConnectionManager iterates REVERSE: `for (let i = length - 1; i >= 0; i--)`
    // And earlier stores (higher priority) overwrite later ones?
    // Code says: "earlier stores (higher priority) overwrite later ones"
    // Loop:
    // for i = 1 (fileStore): map.set(id, profile)
    // for i = 0 (envStore): map.set(id, profile) -> Overwrites.
    // So Index 0 is HIGHEST priority.
    this.connectionManager = new ConnectionManager([envStore, fileStore], credStore);

    this.connectorRegistry = new ConnectorRegistry();

    // 2. Register Connectors

    // this.connectorRegistry.register(new PostgreSQLConnector(new DaemonDriverManager()));

    // 3. Initialize Executor
    const driverManager = new DriverManager();
    this.queryExecutor = new DaemonQueryExecutor(
      this.connectorRegistry,
      this.connectionManager,
      ConsoleLogger.getInstance(),
      driverManager
    );

    // 4. Initialize Tool Manager
    this.toolManager = new DaemonMcpToolManager(
      this.sessionManager,
      this.queryExecutor,
      this.connectionManager,
      this.connectorRegistry
    );

    // Singleton Server/Transport initialization REMOVED in favor of per-connection logic in setupRoutes

    this.setupRoutes();
    this.setupLifecycle();
    this.setupEventBroadcasting();
  }

  private connectedMcpServers = new Set<Server>();

  private setupEventBroadcasting() {
    // Listen to changes in SessionManager
    this.sessionManager.on('tab-added', () => this.broadcastResourceChange());
    this.sessionManager.on('tab-updated', () => this.broadcastResourceChange());
    this.sessionManager.on('tab-removed', () => this.broadcastResourceChange());
  }

  private broadcastResourceChange() {
    logger.info(
      `[Daemon] Broadcasting resource/list_changed to ${this.connectedMcpServers.size} servers`
    );
    this.connectedMcpServers.forEach(async server => {
      try {
        await server.notification({ method: 'notifications/resources/list_changed' });
      } catch (e) {
        // Ignore send errors
        logger.error('[Daemon] Failed to broadcast notification', e);
      }
    });
  }

  private setupRoutes() {
    // Refresh inactivity timer on every request
    this.app.use((_req, _res, next) => {
      this.refreshActivity();
      next();
    });

    // Health check
    this.app.get('/status', (_req, res) => {
      res.send({
        status: 'running',
        service: 'sql-preview-daemon',
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        sessions: this.sessionManager.getAllSessions().length,
        mcpSessions: this.mcpSessions.size,
        pid: process.pid,
      });
    });

    // MCP App React UI Bundle
    this.app.get('/mcp-app', async (_req, res) => {
      try {
        // Resolve relative to out/server/Daemon.js
        const htmlPath = path.join(__dirname, '../../dist/mcp-app.html');
        if (!fs.existsSync(htmlPath)) {
          res.status(404).send('UI bundle not found. Please run "npm run build" first.');
          return;
        }
        res.setHeader('Content-Type', 'text/html');
        fs.createReadStream(htmlPath).pipe(res);
      } catch (err) {
        logger.error('[Daemon] Failed to serve /mcp-app:', err);
        res.status(500).send('Internal Server Error');
      }
    });

    // MCP Endpoint (Multi-Session Support)
    const mcpHandler = async (req: express.Request, res: express.Response) => {
      logger.info(`[Daemon] /mcp request: ${req.method} ${req.url} (Original: ${req.originalUrl})`);
      logger.info(`[Daemon] Headers: ${JSON.stringify(req.headers)}`);
      logger.info(`[Daemon] Query: ${JSON.stringify(req.query)}`);
      try {
        // 1. Determine Session ID
        let sessionId =
          (req.query['sessionId'] as string) || (req.headers['mcp-session-id'] as string);

        if (!sessionId) {
          // Generate a new Session ID if none provided
          sessionId = `session-${crypto.randomUUID()}`;
        }

        // 2. Get existing session
        let mcpSession = this.mcpSessions.get(sessionId);

        // 4. Get or Create Session
        if (!mcpSession) {
          logger.info(`[Daemon] Creating new MCP session: ${sessionId}`);

          // Create dedicated Transport
          // "Stateless" mode: We manage the session ID at the Daemon/Route level.
          // This allows the transport to accept the initial GET request (SSE connection)
          // without requiring a prior POST 'initialize' (which is the SDK's stateful behavior).
          const transport = new StreamableHTTPServerTransport();

          // Create dedicated Server
          const server = new Server(
            { name: 'sql-preview-daemon', version: '1.0.0' },
            { capabilities: { resources: {}, tools: {} } }
          );

          // Register tools (Shared ToolManager)
          new DaemonMcpServer(server, this.sessionManager, this.toolManager);

          // Store
          mcpSession = { server, transport, lastActive: Date.now() };
          this.mcpSessions.set(sessionId, mcpSession);

          // Connect
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await server.connect(transport as any);
        } else {
          // Update activity
          mcpSession.lastActive = Date.now();
        }

        // 4. Delegate to Transport
        const transportPromise = mcpSession.transport.handleRequest(req, res);

        // 5. Force-announce endpoint AFTER transport sets headers
        if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) {
          setTimeout(() => {
            if (!res.writableEnded) {
              res.write(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`);
            }
          }, 10);
        }

        await transportPromise;
      } catch (err) {
        logger.error('[Daemon] Error in mcpHandler:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error' });
        }
      }
    };

    this.app.get('/mcp', mcpHandler);
    this.app.post('/mcp', mcpHandler);

    // Direct Query Endpoint (for Integration Tests / Simple Clients)
    this.app.post('/query', express.json(), async (req, res) => {
      this.refreshActivity();
      try {
        const { query, sessionId } = req.body;
        if (!query) {
          res.status(400).json({ error: 'Query is required' });
          return;
        }

        const sid = sessionId || `test-session-${crypto.randomUUID()}`;

        // Create a temporary controller for this request
        const controller = new AbortController();

        // Use array to collect all rows
        const allRows: unknown[] = [];
        let columns: import('../common/types').ColumnDef[] = [];

        try {
          const generator = this.queryExecutor.execute(
            query,
            sid, // sessionId
            undefined, // connectionId
            controller.signal, // abortSignal
            undefined // connectionOverride
          );

          for await (const page of generator) {
            if (page.columns) {
              columns = page.columns;
            }
            if (page.data) {
              allRows.push(...page.data);
            }
          }

          res.json({
            columns: columns,
            data: allRows,
          });
        } catch (err) {
          logger.error('[Daemon] Query execution failed:', err);
          res.status(500).json({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } catch (err) {
        logger.error('[Daemon] Error in /query:', err);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Session Management API
    this.app.get('/sessions', (_req, res) => {
      this.refreshActivity();
      try {
        res.json(
          this.sessionManager.getAllSessions().map(s => ({
            id: s.id,
            displayName: s.displayName,
            clientType: s.clientType,
            tabCount: s.tabs.size,
          }))
        );
      } catch (err) {
        logger.error('[Daemon] Error in /sessions:', err);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    this.app.get('/sessions/:id/tabs', (req, res) => {
      this.refreshActivity();
      try {
        const session = this.sessionManager.getSession(req.params.id);
        if (!session) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }
        res.json(
          Array.from(session.tabs.values()).map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            rowCount: t.rows?.length || 0,
          }))
        );
      } catch (err) {
        logger.error('[Daemon] Error in /sessions/:id/tabs:', err);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    this.app.get('/sessions/:sid/tabs/:tid', (req, res) => {
      this.refreshActivity();
      try {
        const session = this.sessionManager.getSession(req.params.sid);
        if (!session) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }
        const tab = session.tabs.get(req.params.tid);
        if (!tab) {
          res.status(404).json({ error: 'Tab not found' });
          return;
        }
        res.json({
          ...tab,
          // Send a slice of rows if huge? For now send all.
          // Or if 'offset' query param exists
        });
      } catch (err) {
        logger.error('[Daemon] Error in /sessions/:sid/tabs/:tid:', err);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Error handling middleware (must be last)
    this.app.use(
      (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
        void _next;
        logger.error(`[Daemon] Express Error on ${req.method} ${req.url}:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Internal Server Error',
            message: err.message || 'Unknown error',
          });
        }
      }
    );
  }

  private readonly IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MCP_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for inactivity
  private lastActivityTime = Date.now();
  private idleCheckInterval: ReturnType<typeof setInterval> | undefined;
  private connectedSocketCount = 0;

  private setupLifecycle() {
    // 1. Global Error Handlers
    process.on('uncaughtException', error => {
      logger.error('[Daemon] CRITICAL: Uncaught Exception:', error);
      // Give logger a chance to flush
      setTimeout(() => this.stop(), 100).unref();
      // Force exit if stop takes too long
      setTimeout(() => process.exit(1), 1000).unref();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error(`[Daemon] CRITICAL: Unhandled Rejection at: ${promise} reason: ${reason}`);
      // Consider if we should exit here. For now, log and maybe we can recover?
      // Best practice is often to crash, but for a dev tool daemon, maybe staying alive is better if possible.
      // However, if state is corrupt... let's log heavily.
    });

    // 2. Graceful Shutdown
    const shutdown = (signal: string) => {
      logger.info(`[Daemon] Received ${signal}. Shutting down...`);
      this.stop();
      // process.exit(0) is called in stop()'s cleanup if needed,
      // but usually let node exit naturally after closing servers.
      setTimeout(() => process.exit(0), 1000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // 3. Idle Timeout & Session Cleanup
    this.idleCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceActivity = now - this.lastActivityTime;
      const hasActiveSessions = this.connectedSocketCount > 0;

      // Only shut down if no sockets connected AND timeout exceeded
      if (!hasActiveSessions && timeSinceActivity > this.IDLE_TIMEOUT_MS) {
        logger.info(`[Daemon] Idle timeout (${this.IDLE_TIMEOUT_MS}ms) reached. Shutting down.`);
        shutdown('IDLE_TIMEOUT');
      }

      // Cleanup Stale MCP Sessions
      for (const [id, session] of this.mcpSessions.entries()) {
        if (now - session.lastActive > this.MCP_SESSION_TIMEOUT_MS) {
          logger.info(`[Daemon] Cleaning up idle MCP session: ${id}`);
          // Close/Cleanup logic if needed (Server.close() not exposed directly usually, connection drops)
          // StreamableHTTPServerTransport doesn't have explicit close?
          this.mcpSessions.delete(id);
        }
      }
    }, 60 * 1000); // Check every minute
  }

  private refreshActivity() {
    this.lastActivityTime = Date.now();
  }

  public async start() {
    // 1. PID Check (Prevent multiple instances & Auto-Kill Stale)
    const pidPath = path.join(this.CONFIG_DIR, `server-${this.HTTP_PORT}.pid`);
    try {
      if (fs.existsSync(pidPath)) {
        const pidContent = fs.readFileSync(pidPath, 'utf8');
        const existingPid = parseInt(pidContent, 10);

        if (!isNaN(existingPid) && existingPid !== process.pid) {
          try {
            // Check if process is actually running
            process.kill(existingPid, 0);
            logger.warn(
              `[Daemon] Existing instance detected (PID: ${existingPid}). Attempting to terminate...`
            );

            // Send SIGKILL to forcibly release the port and socket
            process.kill(existingPid, 'SIGKILL');
            logger.info(`[Daemon] Successfully terminated stale instance (PID: ${existingPid}).`);

            // Wait briefly to ensure OS releases resources
            await new Promise(r => setTimeout(r, 500));
          } catch (e) {
            // Process doesn't exist, ignore
            if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
              logger.info(`[Daemon] Cleaning up stale PID file for ${existingPid}`);
            } else {
              logger.error(`[Daemon] Failed to terminate existing process ${existingPid}: ${e}`);
              // Fallback to erroring if we can't kill it (e.g., owned by root)
              process.exit(1);
            }
          }
        }

        // Always clean up the pid file if it exists, since we either killed it or it was dead
        if (fs.existsSync(pidPath)) {
          fs.unlinkSync(pidPath);
        }
      }

      // Write current PID
      fs.writeFileSync(pidPath, process.pid.toString());
    } catch (e) {
      logger.error('[Daemon] Startup error checking PID:', e);
      process.exit(1);
    }

    // Serve Static UI
    // Assuming 'out/server/Daemon.js', we go up to 'out/webviews/daemon'
    const staticDir = path.join(__dirname, '../../webviews/daemon');
    if (fs.existsSync(staticDir)) {
      this.app.use(express.static(staticDir));
    }

    // Start HTTP Server
    await new Promise<void>((resolve, reject) => {
      // Use '0.0.0.0' to ensure we listen on all interfaces (IPv4/IPv6 dual stack support depends on Node version/OS,
      // but 0.0.0.0 covers 127.0.0.1 and usually allows ::1 if mapped).
      // Use '127.0.0.1' to restrict access to localhost only.
      this.httpServer = this.app.listen(this.HTTP_PORT, '127.0.0.1', () => {
        const addr = this.httpServer?.address();
        const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr?.port}`;
        logger.info(`Daemon HTTP listening on http://127.0.0.1:${this.HTTP_PORT} (${bind})`);
        resolve();
      });
      this.httpServer.on('error', reject);
    });

    // Start WebSocket Server here, now that httpServer is definitively bound
    try {
      this.wss = new WebSocket.Server({ noServer: true });
      this.wss.on('connection', async ws => {
        logger.info('Client connected via WebSocket');
        this.connectedSocketCount++;
        this.refreshActivity();

        const transport = new WebSocketServerTransport(ws);

        transport.onerror = err => {
          logger.error('[Daemon] WebSocketTransport Error:', err);
        };

        transport.onclose = () => {
          logger.info('[Daemon] WebSocketTransport Closed');
        };

        // Create a dedicated MCP server for this WS connection
        const server = new Server(
          { name: 'sql-preview-daemon-ws', version: '1.0.0' },
          { capabilities: { resources: {}, tools: {} } }
        );
        this.connectedMcpServers.add(server);

        // Register Handlers
        new DaemonMcpServer(server, this.sessionManager, this.toolManager);

        ws.on('close', () => {
          this.connectedSocketCount--;
          this.connectedMcpServers.delete(server);
          logger.info('Client disconnected from WebSocket');
        });

        try {
          await transport.start();
          await server.connect(transport);
        } catch (error) {
          logger.error('[Daemon] Failed to connect MCP server to WS transport', error);
        }
      });

      if (this.httpServer) {
        this.httpServer.on('upgrade', (request, socket, head) => {
          try {
            logger.info(`[Daemon] WS Upgrade Request Received: ${request.url}`);
            const urlStr = request.url || '';

            // Broad match for /mcp/ws to avoid any parsing edge cases
            if (urlStr.includes('/mcp/ws')) {
              logger.info(`[Daemon] WS Upgrade matched, handling upgrade...`);
              this.wss?.handleUpgrade(
                request as import('http').IncomingMessage,
                socket,
                head,
                ws => {
                  this.wss?.emit('connection', ws, request);
                }
              );
            } else {
              logger.warn(`[Daemon] WS Upgrade rejected (did not match /mcp/ws): ${urlStr}`);
              socket.destroy();
            }
          } catch (err) {
            logger.error('[Daemon] Error in WS upgrade handler', err);
            socket.destroy();
          }
        });
      }
    } catch (e) {
      logger.error('[Daemon] Failed to attach WebSocket server', e);
      throw e;
    }

    // Start Socket Server
    await this.startSocketServer();
  }

  public async startStdio() {
    // 1. Configure Logging to fail-safe Stderr
    ConsoleLogger.getInstance().setUseStdErr(true);
    logger.info('Starting MCP Server in Stdio Mode...');

    // 2. Create Server Instance
    const server = new Server(
      { name: 'sql-preview-daemon-stdio', version: '1.0.0' },
      { capabilities: { resources: {}, tools: {} } }
    );

    // 3. Register Domain Logic
    new DaemonMcpServer(server, this.sessionManager, this.toolManager);

    // 4. Connect Transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('MCP Server connected to Stdio');
  }

  private async startSocketServer() {
    // Clean up old socket URL
    if (fs.existsSync(this.SOCKET_PATH)) {
      try {
        fs.unlinkSync(this.SOCKET_PATH);
      } catch (e) {
        logger.warn('Failed to clean up socket:', e);
      }
    }

    this.socketServer = net.createServer(async socket => {
      logger.info('Client connected via Socket');
      this.connectedSocketCount++;
      this.refreshActivity();

      const transport = new SocketTransport(socket);

      // Add Transport Logging
      transport.onerror = err => {
        logger.error('[Daemon] SocketTransport Error:', err);
      };

      transport.onclose = () => {
        logger.info('[Daemon] SocketTransport Closed');
      };

      // Create dedicated MCP server for this socket connection
      const server = new Server(
        { name: 'sql-preview-daemon-ipc', version: '1.0.0' },
        { capabilities: { resources: {}, tools: {} } }
      );
      this.connectedMcpServers.add(server);

      // Register Handlers
      new DaemonMcpServer(server, this.sessionManager, this.toolManager);

      socket.on('close', () => {
        this.connectedSocketCount--;
        this.connectedMcpServers.delete(server);
        logger.info('Client disconnected from Socket');
      });
      // removed early data listener to prevent swallowing stream data
      try {
        await server.connect(transport);
      } catch (error) {
        logger.error('[Daemon] Failed to connect MCP server to transport', error);
      }
    });

    return new Promise<void>((resolve, reject) => {
      this.socketServer?.listen(this.SOCKET_PATH, () => {
        logger.info(`Daemon IPC listening on ${this.SOCKET_PATH}`);
        resolve();
      });
      this.socketServer?.on('error', reject);
    });
  }

  public stop() {
    logger.info('[Daemon] Stopping servers...');

    if (this.httpServer) {
      this.httpServer.close(err => {
        if (err) {
          logger.error('[Daemon] Error closing HTTP server:', err);
        } else {
          logger.info('[Daemon] HTTP server closed.');
        }
      });
      this.httpServer = null;
    }

    if (this.socketServer) {
      this.socketServer.close(err => {
        if (err) {
          logger.error('[Daemon] Error closing Socket server:', err);
        } else {
          logger.info('[Daemon] Socket server closed.');
        }
      });
      this.socketServer = null;
    }

    if (this.wss) {
      this.wss.close(err => {
        if (err) {
          logger.error('[Daemon] Error closing WebSocket server:', err);
        } else {
          logger.info('[Daemon] WebSocket server closed.');
        }
      });
      this.wss = null;
    }

    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = undefined;
    }

    // Cleanup PID and Socket
    const pidPath = path.join(this.CONFIG_DIR, `server-${this.HTTP_PORT}.pid`);
    if (fs.existsSync(pidPath)) {
      try {
        fs.unlinkSync(pidPath);
      } catch (e) {
        /* ignore */
      }
    }
    if (fs.existsSync(this.SOCKET_PATH)) {
      try {
        fs.unlinkSync(this.SOCKET_PATH);
      } catch (e) {
        /* ignore */
      }
    }
  }
}

// Auto-start if run directly
// Auto-start if run directly
if (require.main === module) {
  const daemon = new Daemon();
  daemon.start().catch(err => {
    logger.error('Failed to start daemon:', err);
    process.exit(1);
  });
}
