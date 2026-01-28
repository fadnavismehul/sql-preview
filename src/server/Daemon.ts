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
// import { PostgreSQLConnector } from '../connectors/postgres/PostgreSQLConnector';

export class Daemon {
  private app: express.Express;
  private httpServer: http.Server | null = null;
  private socketServer: net.Server | null = null;
  private server: Server;

  private sessionManager: SessionManager;
  private connectionManager: FileConnectionManager;
  private connectorRegistry: ConnectorRegistry;
  private queryExecutor: DaemonQueryExecutor;

  // private _mcpServerWrapper: DaemonMcpServer; (Removed)

  private httpTransport: StreamableHTTPServerTransport;

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
    const toolManager = new DaemonMcpToolManager(this.sessionManager, this.queryExecutor);

    // 5. Initialize MCP SDK Server
    this.server = new Server(
      {
        name: 'sql-preview-daemon',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // 6. Initialize MCP Wrapper (Registers Handlers)
    // Instantiated purely for side-effects (registering handlers)
    new DaemonMcpServer(this.server, this.sessionManager, toolManager);

    // 7. Initialize HTTP Transport (Singleton)
    this.httpTransport = new StreamableHTTPServerTransport();
    // Connect HTTP Transport
    // Cast to any to bypass strict optional property checks in Transport interface vs Streamable implementation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.connect(this.httpTransport as any);

    this.setupRoutes();
  }

  private setupRoutes() {
    this.app.use(cors());
    // Note: We do NOT use express.json() globally because StreamableTransport might handle raw streams
    // But StreamableHTTPServerTransport.handleRequest handles it.

    // Health check
    this.app.get('/', (_req, res) => {
      res.send({ status: 'running', service: 'sql-preview-daemon' });
    });

    // MCP Endpoint (HTTP)
    // Handles POST /messages (RPC) and GET /messages (SSE) automatically
    this.app.all('/messages', async (req, res) => {
      await this.httpTransport.handleRequest(req, res);
    });

    // Alias /sse to /messages for compatibility
    this.app.all('/sse', async (req, res) => {
      await this.httpTransport.handleRequest(req, res);
    });

    // Session Management API
    this.app.get('/sessions', (_req, res) => {
      res.json(
        this.sessionManager.getAllSessions().map(s => ({
          id: s.id,
          displayName: s.displayName,
          clientType: s.clientType,
          tabCount: s.tabs.size,
        }))
      );
    });
  }

  public async start() {
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

    this.socketServer = net.createServer(socket => {
      console.log('Client connected via Socket');
      const transport = new SocketTransport(socket);
      this.server.connect(transport);
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
