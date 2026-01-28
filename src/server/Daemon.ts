import express from 'express';
import cors from 'cors';
import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
// import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'; // Removed
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import { SocketTransport } from './SocketTransport';
import { SessionManager } from './SessionManager';
import { FileConnectionManager } from './FileConnectionManager';
import { DaemonQueryExecutor } from './DaemonQueryExecutor';
import { DaemonMcpToolManager } from './DaemonMcpToolManager';
import { DaemonMcpServer } from './DaemonMcpServer';
import { ConnectorRegistry } from '../connectors/base/ConnectorRegistry';
import { TrinoConnector } from '../connectors/trino/TrinoConnector';
import { SQLiteConnector } from '../connectors/sqlite/SQLiteConnector';
// import { PostgreSQLConnector } from '../connectors/postgres/PostgreSQLConnector';

export class Daemon {
  private app: express.Express;
  private httpServer: http.Server | null = null;
  private socketServer: net.Server | null = null;
  private toolManager: DaemonMcpToolManager;
  private activeServers = new Map<string, Server>();
  private activeTransports = new Map<string, SSEServerTransport>();

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
    this.app.use((req, res, next) => {
      console.log(`[Daemon] >> ${req.method} ${req.url}`);
      res.on('finish', () => {
        console.log(`[Daemon] << ${req.method} ${req.url} ${res.statusCode}`);
      });
      next();
    });
    // Note: We do NOT use express.json() globally because StreamableTransport might handle raw streams
    // But StreamableHTTPServerTransport.handleRequest handles it.

    // Health check
    this.app.get('/status', (_req, res) => {
      res.send({ status: 'running', service: 'sql-preview-daemon' });
    });

    // MCP Endpoint (HTTP SSE)
    this.app.get('/sse', async (_req, res) => {
      this.refreshActivity();
      console.log('[Daemon] New SSE Connection Request');

      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;

      const server = new Server(
        { name: 'sql-preview-daemon', version: '1.0.0' },
        { capabilities: { resources: {}, tools: {} } }
      );

      // Register Handlers
      new DaemonMcpServer(server, this.sessionManager, this.toolManager);

      this.activeTransports.set(sessionId, transport);
      this.activeServers.set(sessionId, server);

      transport.onclose = () => {
        console.log(`[Daemon] SSE Transport Closed: ${sessionId}`);
        this.activeTransports.delete(sessionId);
        this.activeServers.delete(sessionId);
      };

      await server.connect(transport);
    });

    // Handle POST Messages
    this.app.post('/messages', async (req, res) => {
      this.refreshActivity();
      const sessionId = req.query['sessionId'] as string;
      if (!sessionId) {
        res.status(400).send('Missing sessionId query parameter');
        return;
      }

      // const transport = this.activeTransports.get(sessionId);
      const transport = this.activeTransports.get(sessionId);
      if (!transport) {
        res.status(404).send(`Session ${sessionId} not found`);
        return;
      }

      await transport.handlePostMessage(req, res);
    });

    // Alias /sse POST for compatibility if needed (though SSEServerTransport directs to /messages)
    this.app.post('/sse', async (req, res) => {
      // Just forward to same logic logic if needed, but strict routing prefers /messages
      // For safety, let's allow it if they pass sessionId
      const sessionId = req.query['sessionId'] as string;
      if (sessionId) {
        const transport = this.activeTransports.get(sessionId);
        if (transport) {
          await transport.handlePostMessage(req, res);
          return;
        }
      }
      res.status(404).end();
    });

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
  }

  private readonly IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private lastActivityTime = Date.now();
  private idleCheckInterval: ReturnType<typeof setInterval> | undefined;
  private connectedSocketCount = 0;

  private setupLifecycle() {
    // Graceful Shutdown
    const shutdown = () => {
      console.log('Shutting down daemon...');
      this.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Idle Timeout
    this.idleCheckInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime;
      const hasActiveSessions = this.connectedSocketCount > 0;

      // Only shut down if no sockets connected AND timeout exceeded
      if (!hasActiveSessions && timeSinceActivity > this.IDLE_TIMEOUT_MS) {
        console.log(`Idle timeout (${this.IDLE_TIMEOUT_MS}ms) reached. Shutting down.`);
        shutdown();
      }
    }, 60 * 1000); // Check every minute
  }

  private refreshActivity() {
    this.lastActivityTime = Date.now();
  }

  public async start() {
    // Write PID File
    const pidPath = path.join(os.homedir(), '.sql-preview', 'server.pid');
    try {
      fs.writeFileSync(pidPath, process.pid.toString());
    } catch (e) {
      console.error('Failed to write PID file:', e);
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
        console.log(`Daemon HTTP listening on http://127.0.0.1:${this.HTTP_PORT}`);
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
        console.warn('Failed to clean up socket:', e);
      }
    }

    this.socketServer = net.createServer(async socket => {
      console.log('Client connected via Socket');
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
        console.log('Client disconnected from Socket');
        // socket transport usually handles its own cleanup, but we could explicitly server.close()
      });
      socket.on('data', () => this.refreshActivity());

      await server.connect(transport);
    });

    return new Promise<void>((resolve, reject) => {
      this.socketServer!.listen(this.SOCKET_PATH, () => {
        console.log(`Daemon IPC listening on ${this.SOCKET_PATH}`);
        resolve();
      });
      this.socketServer!.on('error', reject);
    });
  }

  public stop() {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    if (this.socketServer) {
      this.socketServer.close();
      this.socketServer = null;
    }
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
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
    console.error('Failed to start daemon:', err);
    process.exit(1);
  });
}
