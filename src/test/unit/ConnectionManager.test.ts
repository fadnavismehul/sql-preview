import { ConnectionManager } from '../../services/ConnectionManager';
import { mockContext } from '../setup';
import * as vscode from 'vscode';
import { TrinoConnectionProfile } from '../../common/types';

jest.mock('../../services/DaemonClient');

// Mock vscode.workspace.getConfiguration since it's used in migration
const mockGetConfiguration = jest.fn();
(vscode.workspace.getConfiguration as jest.Mock) = mockGetConfiguration;

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager;
  let mockDaemonClient: any;
  let mockSecrets: Record<string, string> = {};

  beforeEach(() => {
    mockSecrets = {};

    // Mock Secrets
    mockContext.secrets.get.mockImplementation((key: string) => {
      return Promise.resolve(mockSecrets[key]);
    });

    mockContext.secrets.store.mockImplementation((key: string, value: string) => {
      mockSecrets[key] = value;
      return Promise.resolve();
    });

    mockContext.secrets.delete.mockImplementation((key: string) => {
      delete mockSecrets[key];
      return Promise.resolve();
    });

    // Default configuration mock
    mockGetConfiguration.mockReturnValue({
      get: jest.fn((_key, defaultValue) => defaultValue),
    });

    // Mock DaemonClient
    mockDaemonClient = {
      listConnections: jest.fn().mockResolvedValue([]),
      saveConnection: jest.fn().mockResolvedValue(undefined),
      deleteConnection: jest.fn().mockResolvedValue(undefined),
    };

    connectionManager = new ConnectionManager(
      mockContext as unknown as vscode.ExtensionContext,
      mockDaemonClient
    );
  });

  it('should get connections from Daemon and merge passwords', async () => {
    const daemonProfile = {
      id: 'conn1',
      name: 'Test Connection',
      type: 'trino',
      // No password in Daemon
    };

    mockDaemonClient.listConnections.mockResolvedValue([daemonProfile]);
    mockSecrets['sqlPreview.password.conn1'] = 'secretPassword';

    const connections = await connectionManager.getConnections();

    expect(connections.length).toBe(2);
    expect(connections[0]!.id).toBe('conn1');
    expect((connections[0] as any).password).toBe('secretPassword');
    expect(connections[1]!.id).toMatch(/^workspace-fallback-/);
    expect(mockDaemonClient.listConnections).toHaveBeenCalled();
  });

  it('should save connection to Daemon and password to Secrets', async () => {
    const profile: TrinoConnectionProfile = {
      id: 'conn1',
      name: 'Test Connection',
      type: 'trino',
      host: 'localhost',
      port: 8080,
      user: 'admin',
      password: 'secretPassword',
      ssl: false,
    };

    await connectionManager.saveConnection(profile);

    // Verify Daemon call (password stripped)
    expect(mockDaemonClient.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conn1',
        user: 'admin',
      })
    );
    const savedArg = mockDaemonClient.saveConnection.mock.calls[0][0];
    expect(savedArg.password).toBeUndefined();

    // Verify Secrets
    expect(mockSecrets['sqlPreview.password.conn1']).toBe('secretPassword');
  });

  it('should delete connection from Daemon and Secrets', async () => {
    mockSecrets['sqlPreview.password.conn1'] = 'secretPassword';

    await connectionManager.deleteConnection('conn1');

    expect(mockDaemonClient.deleteConnection).toHaveBeenCalledWith('conn1');
    expect(mockSecrets['sqlPreview.password.conn1']).toBeUndefined();
  });

  it('should include workspace fallback profile if configured', async () => {
    // Daemon returns empty
    mockDaemonClient.listConnections.mockResolvedValue([]);

    // Mock Workspace Config to return Trino defaults
    mockGetConfiguration.mockReturnValue({
      get: jest.fn((key, defaultValue) => {
        if (key === 'defaultConnector') {
          return 'trino';
        }
        if (key === 'host') {
          return 'fallback-host';
        }
        return defaultValue;
      }),
    });

    const connections = await connectionManager.getConnections();

    expect(connections.length).toBe(1);
    expect(connections[0]!.id).toBe('workspace-fallback-trino');
    expect((connections[0] as any).host).toBe('fallback-host');
  });
});
