import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { Socket } from 'net';

/**
 * A Transport for MCP over a simplified JSON-RPC Socket connection.
 * Used for Daemon <-> VS Code IPC.
 */
export class SocketTransport implements Transport {
  private _socket: Socket;

  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  constructor(socket: Socket) {
    this._socket = socket;

    // Handle incoming data
    // We assume newline-delimited JSON for simplicity in this V1
    let buffer = '';

    socket.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      // Keep the last partial line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const json = JSON.parse(line);
            // Basic validation or schema check could go here
            if (this.onmessage) {
              this.onmessage(json);
            }
          } catch (e) {
            if (this.onerror) {
              this.onerror(new Error(`Failed to parse JSON message: ${e}`));
            }
          }
        }
      }
    });

    socket.on('close', () => {
      if (this.onclose) {
        this.onclose();
      }
    });

    socket.on('error', err => {
      if (this.onerror) {
        this.onerror(err);
      }
    });
  }

  async start(): Promise<void> {
    // Socket is already connected when passed in
    return Promise.resolve();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const json = JSON.stringify(message);
      this._socket.write(json + '\n', err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async close(): Promise<void> {
    this._socket.end();
  }
}
