import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as cp from 'child_process';
import { DaemonClient } from '../../services/DaemonClient';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Mock dependencies
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  openSync: jest.fn(),
  unlinkSync: jest.fn(),
  readFileSync: jest.fn(),
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
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.openSync as jest.Mock).mockReturnValue(123);

    // Initialize client
    client = new DaemonClient(mockContext);
  });

  describe('start', () => {
    it('should connect to existing socket if available', async () => {
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
      // 1. Initial connect fails
      const failSocket = {
        on: jest.fn((event, cb) => {
          if (event === 'error') {
            cb(new Error('Connect failed'));
          }
        }),
      };

      // Success socket
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
        .mockReturnValue(successSocket);

      // fs logic:
      // 1. cleanupStaleDaemon(pid) -> false
      // 2. socket stale check -> false
      // 3. poll loop -> true

      let callCount = 0;
      (fs.existsSync as jest.Mock).mockImplementation((pathArg: string) => {
        if (pathArg.includes('server.pid')) {
          return false;
        }
        if (pathArg.includes('srv.sock')) {
          callCount++;
          return callCount > 1; // 1st check false, 2nd true
        }
        return false;
      });

      await client.start();

      expect(cp.spawn).toHaveBeenCalled();
      expect(net.createConnection).toHaveBeenCalledTimes(2);
    });

    it('should cleanup stale socket before spawning', async () => {
      const failSocket = {
        on: jest.fn((event, cb) => {
          if (event === 'error') {
            cb(new Error('Connect failed'));
          }
        }),
      };
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
        .mockReturnValue(successSocket);

      // fs logic:
      // 1. cleanupStaleDaemon(pid) -> false
      // 2. socket stale check -> TRUE -> unlink
      // 3. poll loop -> TRUE
      (fs.existsSync as jest.Mock).mockImplementation((pathArg: string) => {
        if (pathArg.includes('server.pid')) {
          return false;
        }
        if (pathArg.includes('srv.sock')) {
          return true; // Always true (stale found, then loop matches)
        }
        return false;
      });

      await client.start();

      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(cp.spawn).toHaveBeenCalled();
    });

    it('should kill stale daemon process if PID file exists', async () => {
      const failSocket = {
        on: jest.fn((event, cb) => {
          if (event === 'error') {
            cb(new Error('Connect failed'));
          }
        }),
      };
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
        .mockReturnValue(successSocket);

      // fs logic:
      // 1. cleanupStaleDaemon(pid) -> TRUE -> read -> kill -> unlink
      // 2. socket stale check -> false
      // 3. poll loop -> true

      let socketCheckCount = 0;
      (fs.existsSync as jest.Mock).mockImplementation((pathArg: string) => {
        if (pathArg.includes('server.pid')) {
          return true;
        }
        if (pathArg.includes('srv.sock')) {
          socketCheckCount++;
          return socketCheckCount > 1;
        }
        return false;
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('9999');

      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await client.start();

      expect(killSpy).toHaveBeenCalledWith(9999, 'SIGTERM');
      expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('server.pid'));
      expect(cp.spawn).toHaveBeenCalled();

      killSpy.mockRestore();
    });
  });

  describe('runQuery', () => {
    it('should call executing tool and return Tab ID', async () => {
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
      expect(mockSocket.end).toHaveBeenCalled();
    });
  });
});
