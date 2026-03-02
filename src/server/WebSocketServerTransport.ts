import { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import * as WebSocket from 'ws';

export class WebSocketServerTransport implements Transport {
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  constructor(private socket: WebSocket.WebSocket) {}

  async start(): Promise<void> {
    this.socket.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString()) as JSONRPCMessage;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(new Error(`Failed to parse message: ${error}`));
      }
    });

    this.socket.on('error', (error: Error) => {
      this.onerror?.(error);
    });

    this.socket.on('close', () => {
      this.onclose?.();
    });
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    void options; // Currently unused in this basic implementation
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not open'));
        return;
      }

      this.socket.send(JSON.stringify(message), (error: Error | undefined) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async close(): Promise<void> {
    this.socket.close();
  }
}
