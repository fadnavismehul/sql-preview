import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as cp from 'child_process';
import { DaemonClient } from '../../services/DaemonClient';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Mock dependencies
// Mock dependencies
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  openSync: jest.fn(),
  unlinkSync: jest.fn(),
}));
jest.mock('net');
jest.mock('child_process');
jest.mock('@modelcontextprotocol/sdk/client/index.js');

describe('DaemonClient', () => {
  let client: DaemonClient;
  let mockContext: vscode.ExtensionContext;
  let mockSocket: any;
  let mockClientInstance: any;
  let mockChildProcess: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock ExtensionContext
    mockContext = {
      extensionPath: '/mock/extension',
      globalStorageUri: { fsPath: '/mock/storage' },
    } as any;

    // Mock Client SDK
    mockClientInstance = {
      connect: jest.fn().mockResolvedValue(undefined),
      callTool: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (Client as unknown as jest.Mock).mockImplementation(() => mockClientInstance);

    // Mock Socket
    mockSocket = {
      on: jest.fn(),
      write: jest.fn((_data, cb) => cb && cb(null)),
      end: jest.fn(),
    };
    (net.createConnection as jest.Mock).mockReturnValue(mockSocket);

    // Mock Child Process
    mockChildProcess = {
      unref: jest.fn(),
      on: jest.fn(),
      stderr: { on: jest.fn() },
      stdout: { on: jest.fn() },
    };
    (cp.spawn as jest.Mock).mockReturnValue(mockChildProcess);

    // Mock fs common setup
    (fs.existsSync as jest.Mock).mockReturnValue(false); // Default: socket doesn't exist
    (fs.openSync as jest.Mock).mockReturnValue(123); // Mock file descriptor

    // Initialize client
    client = new DaemonClient(mockContext);
  });

  describe('start', () => {
    it('should connect to existing socket if available', async () => {
      // Setup: Connect succeeds immediately
      (net.createConnection as jest.Mock).mockReturnValueOnce(mockSocket);
      mockSocket.on.mockImplementation((event: string, cb: any) => {
        if (event === 'connect') {
          cb();
        }
      });

      await client.start();

      expect(net.createConnection).toHaveBeenCalledTimes(1);
      expect(mockClientInstance.connect).toHaveBeenCalled();
      expect(cp.spawn).not.toHaveBeenCalled();
    });

    it('should spawn daemon if connection fails initially', async () => {
      // Setup: First connect fails, then spawn, then connect succeeds

      // 1. Initial connect fails (socket doesn't exist or refused)
      const failSocket = {
        on: jest.fn((event, cb) => {
          if (event === 'error') {
            cb(new Error('Connect failed'));
          }
        }),
      };

      // 2. Poll connect succeeds
      const successSocket = {
        ...mockSocket,
        on: jest.fn((event, cb) => {
          if (event === 'connect') {
            cb();
          }
        }),
      };

      (net.createConnection as jest.Mock)
        .mockReturnValueOnce(failSocket)
        .mockReturnValue(successSocket); // subsequent calls succeed

      // Mock socket file appearing after spawn
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false) // Check before clean
        .mockReturnValueOnce(true); // Check during poll

      await client.start();

      expect(cp.spawn).toHaveBeenCalled();
      expect(net.createConnection).toHaveBeenCalledTimes(2); // 1 fail, 1 success
    });

    it('should cleanup stale socket before spawning', async () => {
      // 1. Initial connect fails
      const failSocket = {
        on: jest.fn((event, cb) => {
          if (event === 'error') {
            cb(new Error('Connect failed'));
          }
        }),
      };
      (net.createConnection as jest.Mock).mockReturnValueOnce(failSocket);

      // 2. fs.existsSync returns true for socket path (stale)
      (fs.existsSync as jest.Mock).mockReturnValueOnce(true).mockReturnValue(true);

      // 3. Poll connect succeeds
      const successSocket = {
        ...mockSocket,
        on: jest.fn((event, cb) => {
          if (event === 'connect') {
            cb();
          }
        }),
      };
      (net.createConnection as jest.Mock).mockReturnValue(successSocket);

      await client.start();

      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(cp.spawn).toHaveBeenCalled();
    });
  });

  describe('runQuery', () => {
    it('should call executing tool and return Tab ID', async () => {
      // Setup client to be connected (conceptually)
      mockClientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Query submitted. Tab ID: tab-123' }],
      });

      const tabId = await client.runQuery('SELECT 1');

      expect(mockClientInstance.callTool).toHaveBeenCalledWith({
        name: 'run_query',
        arguments: expect.objectContaining({
          sql: 'SELECT 1',
          session: expect.any(String),
        }),
      });
      expect(tabId).toBe('tab-123');
    });

    it('should throw error if response is invalid', async () => {
      mockClientInstance.callTool.mockResolvedValue({
        content: [],
      });

      await expect(client.runQuery('SELECT 1')).rejects.toThrow('Invalid response');
    });

    it('should throw error if Tab ID is missing', async () => {
      mockClientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Something else' }],
      });

      await expect(client.runQuery('SELECT 1')).rejects.toThrow('Failed to extract Tab ID');
    });
  });

  describe('getTabInfo', () => {
    it('should return parsed tab info', async () => {
      const mockInfo = { id: 'tab-1', status: 'success' };
      mockClientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(mockInfo) }],
      });

      const info = await client.getTabInfo('tab-1');
      expect(info).toEqual(mockInfo);
      expect(mockClientInstance.callTool).toHaveBeenCalledWith({
        name: 'get_tab_info',
        arguments: expect.objectContaining({ tabId: 'tab-1' }),
      });
    });
  });

  describe('cancelQuery', () => {
    it('should call cancel tool', async () => {
      mockClientInstance.callTool.mockResolvedValue({});

      await client.cancelQuery('tab-1');

      expect(mockClientInstance.callTool).toHaveBeenCalledWith({
        name: 'cancel_query',
        arguments: expect.objectContaining({ tabId: 'tab-1' }),
      });
    });
  });

  describe('stop', () => {
    it('should close client and transport', async () => {
      mockSocket.on.mockImplementation((event: string, cb: any) => {
        if (event === 'connect') {
          cb();
        }
      });
      (net.createConnection as jest.Mock).mockReturnValue(mockSocket);

      await client.start();
      await client.stop();

      expect(mockClientInstance.close).toHaveBeenCalled();
      expect(mockSocket.end).toHaveBeenCalled(); // via transport.close()
    });
  });
});
