import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// We need a transport. Since Client runs in Node (Extension Host), we can use a Socket Client Transport?
// SDK doesn't export a simple SocketClientTransport usually?
// logic: we can implement one easily. It just needs to read/write JSON-RPC.
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

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
            console.error('Failed to parse IPC message', e);
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

  constructor(private readonly context: vscode.ExtensionContext) {
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Determine Socket Path (Same as Daemon)
    // TODO: Shared constant
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.sql-preview');
    this.socketPath = path.join(configDir, 'srv.sock');

    this.client = new Client({ name: 'vscode-extension', version: '1.0.0' }, { capabilities: {} });
  }

  public getSessionId() {
    return this.sessionId;
  }

  public async start() {
    // 1. Try connect
    try {
      await this.connect();
    } catch (e) {
      console.log('Daemon not running, starting...', e);
      // 2. Start Daemon
      await this.spawnDaemon();
      // 3. Retry connect
      await new Promise(r => setTimeout(r, 1000)); // Wait for startup
      await this.connect();
    }
  }

  private async spawnDaemon() {
    // Path to Daemon.js
    // If running in dev: src/server/Daemon.ts (via ts-node?) - No, we compile to out/
    // out/server/Daemon.js
    const serverPath = path.join(this.context.extensionPath, 'out', 'server', 'Daemon.js');

    this.process = cp.spawn('node', [serverPath], {
      detached: true,
      stdio: 'ignore',
    });

    this.process.unref(); // Let it run independently
  }

  private async connect() {
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);

      socket.on('connect', () => {
        this.transport = new SocketClientTransport(socket);
        this.client
          .connect(this.transport)
          .then(async () => {
            // Register Session immediately
            try {
              await this.client.callTool({
                name: 'register_session',
                arguments: {
                  sessionId: this.sessionId,
                  displayName: 'VS Code Extension',
                  clientType: 'vscode',
                },
              });
              resolve();
            } catch (e) {
              console.error('Failed to register session', e);
              reject(e);
            }
          })
          .catch(reject);
      });

      socket.on('error', err => {
        reject(err);
      });
    });
  }

  public async runQuery(sql: string, newTab = true, connectionProfile?: any): Promise<string> {
    // Call run_query tool
    const result = await this.client.callTool({
      name: 'run_query',
      arguments: {
        sql,
        session: this.sessionId,
        newTab,
        connectionProfile,
      },
    });

    // Parse result content for Tab ID
    const content = result.content as { type: string; text: string }[];
    if (!content || !content[0] || !content[0].text) {
      throw new Error('Invalid response from daemon');
    }

    const text = content[0].text;
    const match = text.match(/Tab ID: (tab-[^.]+)/);
    if (match && match[1]) {
      return match[1];
    }
    throw new Error('Failed to extract Tab ID from: ' + text);
  }

  public async getTabInfo(tabId: string, offset = 0) {
    const result = await this.client.callTool({
      name: 'get_tab_info',
      arguments: {
        session: this.sessionId,
        tabId,
        offset,
      },
    });

    const content = result.content as { type: string; text: string }[];
    if (!content || !content[0] || !content[0].text) {
      throw new Error('Invalid response from daemon');
    }

    const text = content[0].text;
    return JSON.parse(text);
  }

  public async cancelQuery(tabId: string) {
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
}
