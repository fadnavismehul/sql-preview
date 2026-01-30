import { ConnectionManager } from '../../services/ConnectionManager';
import { mockContext } from '../setup';
import * as vscode from 'vscode';
import { TrinoConnectionProfile } from '../../common/types';

// Mock vscode.workspace.getConfiguration since it's used in migration
const mockGetConfiguration = jest.fn();
(vscode.workspace.getConfiguration as jest.Mock) = mockGetConfiguration;

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager;
  let mockConnections: any[] = [];
  let mockSecrets: Record<string, string> = {};

  beforeEach(() => {
    mockConnections = [];
    mockSecrets = {};

    // Reset mocks
    mockContext.globalState.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'sqlPreview.connections') {
        return mockConnections;
      }
      return defaultValue;
    });

    mockContext.globalState.update.mockImplementation((key: string, value: any) => {
      if (key === 'sqlPreview.connections') {
        mockConnections = value;
      }
      return Promise.resolve();
    });

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

    connectionManager = new ConnectionManager(mockContext as unknown as vscode.ExtensionContext);
  });

  it('should save a connection profile securely', async () => {
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

    // Verify profile saved in globalState without password
    expect(mockConnections.length).toBe(1);
    expect(mockConnections[0].id).toBe('conn1');
    expect(mockConnections[0].user).toBe('admin');
    expect(mockConnections[0].password).toBeUndefined();

    // Verify password saved in secrets
    expect(mockSecrets['sqlPreview.password.conn1']).toBe('secretPassword');
  });

  it('should retrieve a connection with password', async () => {
    const profile: TrinoConnectionProfile = {
      id: 'conn1',
      name: 'Test Connection',
      type: 'trino',
      host: 'localhost',
      port: 8080,
      user: 'admin',
      ssl: false,
    };
    mockConnections.push(profile);
    mockSecrets['sqlPreview.password.conn1'] = 'secretPassword';

    const retrieved = await connectionManager.getConnection('conn1');

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('conn1');
    expect((retrieved as any).password).toBe('secretPassword');
  });

  it('should return undefined for non-existent connection', async () => {
    const retrieved = await connectionManager.getConnection('non_existent');
    expect(retrieved).toBeUndefined();
  });

  it('should delete a connection and its password', async () => {
    const profile: TrinoConnectionProfile = {
      id: 'conn1',
      name: 'Test Connection',
      type: 'trino',
      host: 'localhost',
      port: 8080,
      user: 'admin',
      ssl: false,
    };
    mockConnections.push(profile);
    mockSecrets['sqlPreview.password.conn1'] = 'secretPassword'; // Correct key

    await connectionManager.deleteConnection('conn1');

    expect(mockConnections.length).toBe(0);
    expect(mockSecrets['sqlPreview.password.conn1']).toBeUndefined();
  });

  it('should migrate legacy settings if no connections exist', async () => {
    // Ensure no connections exist
    mockConnections = [];

    // Mock legacy configuration
    mockGetConfiguration.mockReturnValue({
      get: jest.fn((key, defaultValue) => {
        if (key === 'defaultConnector') {
          return 'trino';
        }
        if (key === 'host') {
          return 'legacy-host';
        }
        if (key === 'port') {
          return 9090;
        }
        if (key === 'user') {
          return 'legacy-user';
        }
        return defaultValue;
      }),
    });

    // Mock legacy password
    mockSecrets['sqlPreview.database.password'] = 'legacyPassword';

    await connectionManager.migrateLegacySettings();

    expect(mockConnections.length).toBe(1);
    const migrated = mockConnections[0];
    expect(migrated.host).toBe('legacy-host');
    expect(migrated.port).toBe(9090);
    expect(migrated.user).toBe('legacy-user');

    // Verify password migration (it should be set via saveConnection -> setPassword)
    // Since id is generated with Date.now(), we need to find the key
    const passwordKey = Object.keys(mockSecrets).find(k =>
      k.startsWith('sqlPreview.password.default-trino-')
    );
    expect(passwordKey).toBeDefined();
    if (passwordKey) {
      expect(mockSecrets[passwordKey]).toBe('legacyPassword');
    }
  });

  it('should NOT migrate if connections already exist', async () => {
    mockConnections = [{ id: 'existing', name: 'Existing', type: 'trino' }];

    await connectionManager.migrateLegacySettings();

    // Should still be just 1
    expect(mockConnections.length).toBe(1);
    expect(mockConnections[0].id).toBe('existing');
  });
});
