import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import * as fs from 'fs';
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
    // Short session ID to save tokens for LLM agents
    this.sessionId = Math.random().toString(36).substring(2, 10);

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
    await this.ensureServerRunning();
  }

  private async ensureServerRunning() {
    // 1. Try connect
    try {
      await this.connect();
      return;
    } catch (e) {
      // Ignore error, proceed to start
    }

    console.log('Daemon not running or unreachable, starting...');

    // 2. Clean up stale socket
    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch (e) {
        console.warn('Failed to unlink stale socket:', e);
      }
    }

    // 3. Start Daemon
    await this.spawnDaemon();

    // 4. Wait for socket (Poll)
    const timeout = 10000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (fs.existsSync(this.socketPath)) {
        try {
          await this.connect();
          console.log('Successfully connected to new daemon instance.');
          return;
        } catch (e) {
          // Socket exists but maybe not listening yet
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
    const serverPath = path.join(this.context.extensionPath, 'out', 'server', 'Daemon.js');

    const logPath = path.join(os.homedir(), '.sql-preview', 'daemon.log');
    const out = fs.openSync(logPath, 'a');
    const err = fs.openSync(logPath, 'a');

    this.process = cp.spawn('node', [serverPath], {
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, SQL_PREVIEW_DAEMON: '1' },
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
          .then(() => {
            resolve();
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
    if (!content || content.length === 0 || !content[0]!.text) {
      throw new Error('Invalid response from daemon');
    }

    const text = content[0]!.text;
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
