import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as crypto from 'crypto';
import * as net from 'net';
import * as os from 'os';
import * as fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// We need a transport. Since Client runs in Node (Extension Host), we can use a Socket Client Transport?
// SDK doesn't export a simple SocketClientTransport usually?
// logic: we can implement one easily. It just needs to read/write JSON-RPC.
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Logger } from '../core/logging/Logger';

class SocketClientTransport implements Transport {
  private socket: net.Socket;

  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  constructor(socket: net.Socket) {
    this.socket = socket;

    let buffer = '';

    this.socket.on('data', data => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      // Keep the last partial line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            this.onmessage?.(msg);
          } catch (e) {
            // Ignore parse errors from partially read chunks or garbage
          }
        }
      }
    });
    this.socket.on('close', () => this.onclose?.());
    this.socket.on('error', err => this.onerror?.(err));
  }

  async start() {
    // Socket should be connected already
  }

  async send(message: JSONRPCMessage) {
    return new Promise<void>((resolve, reject) => {
      this.socket.write(JSON.stringify(message) + '\n', err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async close() {
    this.socket.end();
  }
}

export class DaemonClient {
  private client: Client;
  private transport: SocketClientTransport | undefined;
  private sessionId: string;
  private process: cp.ChildProcess | undefined;
  private socketPath: string;
  private readyPromise: Promise<void> | undefined;
  private startupLogBuffer = '';
  private isConnected = false;
  public onRefresh?: () => void;

  private configDir: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    // Persistent Session ID
    const STORAGE_KEY = 'sqlPreview.sessionId';
    let storedId = this.context.workspaceState.get<string>(STORAGE_KEY);

    if (!storedId) {
      storedId = crypto.randomUUID();
      this.context.workspaceState.update(STORAGE_KEY, storedId);
    }
    this.sessionId = storedId;

    // Determine Socket Path
    const homeDir = os.homedir();
    const devPort = process.env['SQL_PREVIEW_MCP_PORT'];
    this.configDir = devPort
      ? path.join(homeDir, '.sql-preview-debug')
      : path.join(homeDir, '.sql-preview');
    const port = process.env['SQL_PREVIEW_MCP_PORT'] || '8414';
    this.socketPath = path.join(this.configDir, `srv-${port}.sock`);

    this.client = new Client({ name: 'vscode-extension', version: '1.0.0' }, { capabilities: {} });
  }

  public getSessionId() {
    return this.sessionId;
  }

  public async closeTab(tabId: string) {
    if (!this.isConnected) {
      return;
    }
    try {
      await this.client.callTool({
        name: 'close_tab',
        arguments: {
          session: this.sessionId,
          tabId: tabId,
        },
      });
    } catch (e) {
      Logger.getInstance().error(`Failed to close remote tab ${tabId}`, e);
    }
  }

  public async start() {
    this.readyPromise = this.ensureServerRunning();
    await this.readyPromise;
  }

  private async ensureServerRunning() {
    // 1. Try connect
    try {
      await this.connect();
      return;
    } catch (e) {
      // Ignore error, proceed to start
    }

    // 2. Kill stale daemon if exists
    await this.cleanupStaleDaemon();

    // 3. Clean up stale socket
    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch (e) {
        // Ignore unlink error
      }
    }

    // 3. Start Daemon
    await this.spawnDaemon();

    // 4. Wait for socket (Poll)
    const timeout = 30000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.process && this.process.exitCode !== null) {
        const logs = this.startupLogBuffer || 'No logs captured';
        throw new Error(
          `Daemon exited prematurely with code ${this.process.exitCode}.\nLogs:\n${logs}`
        );
      }

      if (fs.existsSync(this.socketPath)) {
        try {
          await this.connect();
          return;
        } catch (e) {
          // Socket exists but maybe not listening yet.
          // Retry once after short delay before failing this iteration to handle race condition
          await new Promise(r => setTimeout(r, 100));
          try {
            await this.connect();
            return;
          } catch (e2) {
            // Ignore and continue to main loop wait
          }
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }

    throw new Error('Timed out waiting for daemon to start.');
  }

  private async spawnDaemon() {
    // Path to Daemon.js
    // If running in dev with ts-node, we might need adjustments,
    // but assuming compiled 'out' structure for production/standard run.
    const serverPath = path.join(this.context.extensionPath, 'out', 'server', 'daemon.js');

    const devPort = process.env['SQL_PREVIEW_MCP_PORT'];
    const portToUse = devPort; // Ignore config port, force 8414 or env var

    // Robust PATH for Mac/Linux if node is not in VS Code's inherited env
    const robustPath = [
      process.env['PATH'],
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
      process.env['HOME'] ? path.join(process.env['HOME'], '.nvm/versions/node/current/bin') : '',
    ]
      .filter(Boolean)
      .join(path.delimiter);

    this.process = cp.spawn('node', [serverPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: robustPath,
        SQL_PREVIEW_DAEMON: '1',
        SQL_PREVIEW_HOME: this.configDir,
        SQL_PREVIEW_LOG_LEVEL:
          process.env['SQL_PREVIEW_LOG_LEVEL'] ||
          vscode.workspace.getConfiguration('sqlPreview').get<string>('logLevel', 'INFO'),
        ...(portToUse ? { MCP_PORT: portToUse } : {}),
      },
    });

    this.process.on('error', err => {
      Logger.getInstance().error('Failed to spawn daemon process', err);
      this.startupLogBuffer += `\nSpawn Error: ${err.message}`;
    });

    this.process.unref(); // Let it run independently

    const outputChannel = Logger.getInstance().getOutputChannel();

    // Pipe stdout
    if (this.process.stdout) {
      this.process.stdout.on('data', data => {
        outputChannel.append(data.toString());
      });
    }

    // Capture stderr for debugging startup failures AND log to output
    if (this.process.stderr) {
      this.process.stderr.on('data', data => {
        const chunk = data.toString();

        // Stream to output channel
        outputChannel.append(chunk);

        // Append to startup buffer
        this.startupLogBuffer = (this.startupLogBuffer || '') + chunk;
        // Limit buffer size
        if (this.startupLogBuffer.length > 2000) {
          this.startupLogBuffer = this.startupLogBuffer.substring(
            this.startupLogBuffer.length - 2000
          );
        }
      });
    }
  }

  private async connect() {
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);

      socket.on('connect', () => {
        this.isConnected = true;
        this.transport = new SocketClientTransport(socket);
        this.client
          .connect(this.transport)
          .then(async () => {
            // Listen for Resource Updates
            // Simple Debounce for Refresh
            let refreshTimeout: NodeJS.Timeout | undefined;

            this.client.setNotificationHandler(
              z.object({ method: z.literal('notifications/resources/list_changed') }),
              async () => {
                const logger = Logger.getInstance();
                logger.info('[DaemonClient] Received notifications/resources/list_changed');

                if (refreshTimeout) {
                  clearTimeout(refreshTimeout);
                }

                refreshTimeout = setTimeout(() => {
                  logger.info('[DaemonClient] Debounce triggered: Refreshing sessions...');
                  this.onRefresh?.();
                  refreshTimeout = undefined;
                }, 500);
              }
            );
            resolve();
          })
          .catch(reject);
      });

      socket.on('close', () => {
        this.isConnected = false;
      });

      socket.on('error', err => {
        this.isConnected = false;
        reject(err);
      });
    });
  }

  public async runQuery(
    sql: string,
    newTab = true,
    connectionProfile?: unknown,
    tabId?: string
  ): Promise<string> {
    if (!this.isConnected) {
      await this.start();
    } else if (this.readyPromise) {
      await this.readyPromise;
    }
    // Call run_query tool
    const result = await this.client.callTool({
      name: 'run_query',
      arguments: {
        sql,
        session: this.sessionId,
        newTab,
        connectionProfile,
        tabId,
      },
    });

    // Parse result content for Tab ID
    const content = result.content as { type: string; text: string }[];
    if (!content || content.length === 0 || !content[0]!.text) {
      throw new Error('Invalid response from daemon');
    }

    const text = content[0]?.text;
    if (!text) {
      throw new Error('Invalid response from daemon');
    }
    const match = text.match(/Tab ID: ([a-zA-Z0-9-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    throw new Error('Failed to extract Tab ID from: ' + text);
  }

  public async getTabInfo(tabId: string, offset = 0, limit?: number) {
    if (!this.isConnected) {
      await this.start();
    } else if (this.readyPromise) {
      await this.readyPromise;
    }
    const result = await this.client.callTool({
      name: 'get_tab_info',
      arguments: {
        session: this.sessionId,
        tabId,
        mode: 'page',
        offset,
        ...(limit !== undefined && { limit }),
      },
    });

    const content = result.content as { type: string; text: string }[];
    if (!content || !content[0] || !content[0].text) {
      throw new Error('Invalid response from daemon');
    }

    const text = content[0].text;
    return JSON.parse(text);
  }

  public async listSessions() {
    if (!this.isConnected) {
      await this.start();
    }
    const result = await this.client.callTool({
      name: 'list_sessions',
      arguments: {},
    });
    const content = result.content as { type: string; text: string }[];
    if (content && content[0]?.text) {
      return JSON.parse(content[0].text);
    }
    return [];
  }

  public async cancelQuery(tabId: string) {
    if (!this.isConnected) {
      await this.start();
    } else if (this.readyPromise) {
      await this.readyPromise;
    }
    await this.client.callTool({
      name: 'cancel_query',
      arguments: {
        session: this.sessionId,
        tabId,
      },
    });
  }

  public async stop() {
    await this.client.close();
    if (this.transport) {
      await this.transport.close();
    }
  }

  private async cleanupStaleDaemon() {
    // Default port is 8414 if not specified by env
    const port = process.env['SQL_PREVIEW_MCP_PORT'] || '8414';
    const pidPath = path.join(this.configDir, `server-${port}.pid`);

    if (fs.existsSync(pidPath)) {
      try {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
        if (!isNaN(pid)) {
          // Check if process exists and kill it
          try {
            process.kill(pid, 'SIGTERM');
            // Give it a moment to exit
            await new Promise(r => setTimeout(r, 1000));
            // Force kill if still running
            try {
              process.kill(pid, 0);
              process.kill(pid, 'SIGKILL');
            } catch (e) {
              // Already gone
            }
          } catch (e) {
            // Process probably doesn't exist
          }
        }
        // Remove PID file
        fs.unlinkSync(pidPath);
      } catch (e) {
        // Ignore read/unlink errors
      }
    }
  }
}
