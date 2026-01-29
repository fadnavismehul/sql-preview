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
  // private activeServers = new Map<string, Server>();
  // private activeTransports = new Map<string, SSEServerTransport>();

  private sessionManager: SessionManager;
  private connectionManager: FileConnectionManager;
  private connectorRegistry: ConnectorRegistry;
  private queryExecutor: DaemonQueryExecutor;

  private readonly HTTP_PORT = 8414;
  private readonly SOCKET_PATH: string;

  constructor() {
    this.app = express();

    // Determine Socket Path
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.sql-preview');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    this.SOCKET_PATH = path.join(configDir, 'srv.sock');

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
    this.setupLifecycle();
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
        pid: process.pid,
      });
    });

    // Streamable HTTP Transport (Global)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      },
    });

    const server = new Server(
      { name: 'sql-preview-daemon', version: '1.0.0' },
      { capabilities: { resources: {}, tools: {} } }
    );

    // Register Handlers
    new DaemonMcpServer(server, this.sessionManager, this.toolManager);

    server.connect(transport);

    // MCP Endpoint
    this.app.use('/mcp', async (req, res) => {
      await transport.handleRequest(req, res);
    });

    // Legacy /sse alias removed

    // Legacy /messages alias removed

    // Session Management API
    this.app.get('/sessions', (_req, res) => {
      this.refreshActivity();
      res.json(
        this.sessionManager.getAllSessions().map(s => ({
          id: s.id,
          displayName: s.displayName,
          clientType: s.clientType,
          tabCount: s.tabs.size,
        }))
      );
    });

    this.app.get('/sessions/:id/tabs', (req, res) => {
      this.refreshActivity();
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
    });

    this.app.get('/sessions/:sid/tabs/:tid', (req, res) => {
      this.refreshActivity();
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
    });

    // Error handling middleware (must be last)
    this.app.use(
      (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
        void _next;
        logger.error(`[Daemon] Express Error on ${req.method} ${req.url}:`, err);
        res.status(500).json({
          error: 'Internal Server Error',
          message: err.message || 'Unknown error',
        });
      }
    );
  }

  private readonly IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private lastActivityTime = Date.now();
  private idleCheckInterval: ReturnType<typeof setInterval> | undefined;
  private connectedSocketCount = 0;

  private setupLifecycle() {
    // 1. Global Error Handlers
    process.on('uncaughtException', error => {
      logger.error('[Daemon] CRITICAL: Uncaught Exception:', error);
      // Give logger a chance to flush
      setTimeout(() => this.stop(), 100).unref();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error(`[Daemon] CRITICAL: Unhandled Rejection at: ${promise} reason: ${reason}`);
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

    // 3. Idle Timeout
    this.idleCheckInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime;
      const hasActiveSessions = this.connectedSocketCount > 0;

      // Only shut down if no sockets connected AND timeout exceeded
      if (!hasActiveSessions && timeSinceActivity > this.IDLE_TIMEOUT_MS) {
        logger.info(`[Daemon] Idle timeout (${this.IDLE_TIMEOUT_MS}ms) reached. Shutting down.`);
        shutdown('IDLE_TIMEOUT');
      }
    }, 60 * 1000); // Check every minute
  }

  private refreshActivity() {
    this.lastActivityTime = Date.now();
  }

  public async start() {
    const configDir = path.join(os.homedir(), '.sql-preview');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // 1. PID Check (Prevent multiple instances)
    const pidPath = path.join(configDir, 'server.pid');
    if (fs.existsSync(pidPath)) {
      const existingPid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
      try {
        // Check if process is actually running
        process.kill(existingPid, 0);
        logger.error(`[Daemon] ERROR: Another instance is already running (PID: ${existingPid})`);
        process.exit(1);
      } catch (e) {
        // Process is not running, stale PID file
        logger.info(`[Daemon] Cleaning up stale PID file for ${existingPid}`);
        fs.unlinkSync(pidPath);
      }
    }

    // Write current PID
    try {
      fs.writeFileSync(pidPath, process.pid.toString());
    } catch (e) {
      logger.error('[Daemon] Failed to write PID file:', e);
    }

    // Serve Static UI
    // Assuming 'out/server/Daemon.js', we go up to 'out/webviews/daemon'
    const staticDir = path.join(__dirname, '../../webviews/daemon');
    if (fs.existsSync(staticDir)) {
      this.app.use(express.static(staticDir));
    }

    // Start HTTP Server
    await new Promise<void>((resolve, reject) => {
      this.httpServer = this.app.listen(this.HTTP_PORT, '127.0.0.1', () => {
        logger.info(`Daemon HTTP listening on http://127.0.0.1:${this.HTTP_PORT}`);
        resolve();
      });
      this.httpServer.on('error', reject);
    });

    // Start Socket Server
    await this.startSocketServer();
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

      // Register Handlers
      new DaemonMcpServer(server, this.sessionManager, this.toolManager);

      // We don't necessarily need to track socket servers in activeServers map unless we want to close them explicitly,
      // but they will close when socket closes.

      socket.on('close', () => {
        this.connectedSocketCount--;
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
    const pidPath = path.join(os.homedir(), '.sql-preview', 'server.pid');
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
