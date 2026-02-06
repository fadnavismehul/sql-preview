import express from 'express';
import cors from 'cors';
import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { SocketTransport } from './SocketTransport';
import { SessionManager } from './SessionManager';
import { FileConnectionManager } from './FileConnectionManager';
import { DaemonQueryExecutor } from './DaemonQueryExecutor';
import { DaemonMcpToolManager } from './DaemonMcpToolManager';
import { DaemonMcpServer } from './DaemonMcpServer';
import { ConnectorRegistry } from '../connectors/base/ConnectorRegistry';
import { TrinoConnector } from '../connectors/trino/TrinoConnector';
import { SQLiteConnector } from '../connectors/sqlite/SQLiteConnector';
import { logger } from './ConsoleLogger';

export class Daemon {
  private app: express.Express;
  private httpServer: http.Server | null = null;
  private socketServer: net.Server | null = null;
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
  private connectionManager: FileConnectionManager;
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
    this.SOCKET_PATH = path.join(this.CONFIG_DIR, 'srv.sock');

    // 1. Initialize Managers
    this.sessionManager = new SessionManager();
    this.connectionManager = new FileConnectionManager();
    this.connectorRegistry = new ConnectorRegistry();

    // 2. Register Connectors
    this.connectorRegistry.register(new TrinoConnector());
    this.connectorRegistry.register(new SQLiteConnector());
    // this.connectorRegistry.register(new PostgreSQLConnector(new DaemonDriverManager()));

    // 3. Initialize Executor
    this.queryExecutor = new DaemonQueryExecutor(this.connectorRegistry, this.connectionManager);

    // 4. Initialize Tool Manager
    this.toolManager = new DaemonMcpToolManager(this.sessionManager, this.queryExecutor);

    // Singleton Server/Transport initialization REMOVED in favor of per-connection logic in setupRoutes

    this.setupRoutes();
    this.setupRoutes();
    this.setupLifecycle();
    this.setupEventBroadcasting();
  }

  private connectedMcpServers = new Set<Server>();

  private setupEventBroadcasting() {
    // Listen to changes in SessionManager
    this.sessionManager.on('tab-added', () => this.broadcastResourceChange());
    this.sessionManager.on('tab-updated', () => this.broadcastResourceChange());
  }

  private broadcastResourceChange() {
    logger.info(`[Daemon] Broadcasting resource/list_changed to ${this.connectedMcpServers.size} servers`);
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
    this.app.use(cors());

    // Request Logging
    this.app.use((_req, res, next) => {
      this.refreshActivity();
      res.on('finish', () => {
        // Request finished
      });
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

    // MCP Endpoint (Multi-Session Support)
    const mcpHandler = async (req: express.Request, res: express.Response) => {
      logger.info(`[Daemon] /mcp request: ${req.method} ${req.url} (Original: ${req.originalUrl})`);
      try {
        // 1. Determine Session ID
        let sessionId =
          (req.query['sessionId'] as string) || (req.headers['mcp-session-id'] as string);

        if (!sessionId) {
          // Generate a new Session ID if none provided
          sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        }

        // 2. Get or Create Session
        let mcpSession = this.mcpSessions.get(sessionId);

        if (!mcpSession) {
          logger.info(`[Daemon] Creating new MCP session: ${sessionId}`);

          // Create dedicated Transport
          // "Stateless" mode: We manage the session ID at the Daemon/Route level.
          // This allows the transport to accept the initial GET request (SSE connection)
          // without requiring a prior POST 'initialize' (which is the SDK's stateful behavior).
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });

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
          await server.connect(transport);
        } else {
          // Update activity
          mcpSession.lastActive = Date.now();
        }

        // 3. Delegate to Transport
        await mcpSession.transport.handleRequest(req, res);

        // 4. Force-announce endpoint (StreamableHTTPServerTransport doesn't do it automatically)
        // Only write if the response is still open (i.e. successful SSE connection)
        if (!res.writableEnded && req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) {
          res.write(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`);
        }
      } catch (err) {
        logger.error('[Daemon] Error in mcpHandler:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error' });
        }
      }
    };

    this.app.get('/mcp', mcpHandler);
    this.app.post('/mcp', mcpHandler);

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
    // 1. PID Check (Prevent multiple instances)
    const pidPath = path.join(this.CONFIG_DIR, 'server.pid');
    try {
      if (fs.existsSync(pidPath)) {
        const pidContent = fs.readFileSync(pidPath, 'utf8');
        const existingPid = parseInt(pidContent, 10);

        if (!isNaN(existingPid)) {
          try {
            // Check if process is actually running
            process.kill(existingPid, 0);
            logger.error(
              `[Daemon] ERROR: Another instance is already running (PID: ${existingPid})`
            );
            process.exit(1);
          } catch (e) {
            // Process is not running (man process.kill says throws if process not found)
            if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
              logger.info(`[Daemon] Cleaning up stale PID file for ${existingPid}`);
              fs.unlinkSync(pidPath);
            } else {
              // Other error (EPERM etc) - process exists but we can't signal it? Assume running.
              logger.error(`[Daemon] ERROR: Cannot check process ${existingPid}: ${e}`);
              process.exit(1);
            }
          }
        } else {
          // Invalid PID file content
          logger.warn('[Daemon] Invalid PID file found, removing.');
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
      // Use 'localhost' to support both IPv4 and IPv6 depending on OS resolution.
      // The client (fetch) might try ::1, so we must be listening on it.
      this.httpServer = this.app.listen(this.HTTP_PORT, 'localhost', () => {
        logger.info(`Daemon HTTP listening on http://localhost:${this.HTTP_PORT}`);
        resolve();
      });
      this.httpServer.on('error', reject);
    });

    // Start Socket Server
    await this.startSocketServer();

    // MCP Server connection is now handled on-demand per session in /mcp route
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

      // Create dedicated MCP server for this socket connection
      const server = new Server(
        { name: 'sql-preview-daemon-ipc', version: '1.0.0' },
        { capabilities: { resources: {}, tools: {} } }
      );
      this.connectedMcpServers.add(server);

      // Register Handlers
      new DaemonMcpServer(server, this.sessionManager, this.toolManager);

      // We don't necessarily need to track socket servers in activeServers map unless we want to close them explicitly,
      // but they will close when socket closes.

      socket.on('close', () => {
        this.connectedSocketCount--;
        this.connectedMcpServers.delete(server);
        logger.info('Client disconnected from Socket');
        // socket transport usually handles its own cleanup, but we could explicitly server.close()
      });
      socket.on('data', () => this.refreshActivity());

      await server.connect(transport);
    });

    return new Promise<void>((resolve, reject) => {
      this.socketServer!.listen(this.SOCKET_PATH, () => {
        logger.info(`Daemon IPC listening on ${this.SOCKET_PATH}`);
        resolve();
      });
      this.socketServer!.on('error', reject);
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

    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = undefined;
    }

    // Cleanup PID and Socket
    const pidPath = path.join(this.CONFIG_DIR, 'server.pid');
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
if (require.main === module) {
  const daemon = new Daemon();
  daemon.start().catch(err => {
    logger.error('Failed to start daemon:', err);
    process.exit(1);
  });
}
