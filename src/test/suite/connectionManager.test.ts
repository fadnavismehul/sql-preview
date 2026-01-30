import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConnectionManager } from '../../services/ConnectionManager';
import { TrinoConnectionProfile } from '../../common/types';

describe('ConnectionManager Test Suite', () => {
  let context: vscode.ExtensionContext;
  let globalStateStub: any;
  let secretsStub: any;
  let connectionManager: ConnectionManager;

  const mockProfile: TrinoConnectionProfile = {
    id: 'test-id',
    name: 'Test Profile',
    type: 'trino',
    host: 'localhost',
    port: 8080,
    user: 'test-user',
    password: 'secure-password',
    ssl: false,
    sslVerify: true,
  };

  beforeEach(() => {
    // Mock globalState
    const state: Record<string, any> = {};
    globalStateStub = {
      get: (key: string, defaultValue: any) => state[key] || defaultValue,
      update: (key: string, value: any) => {
        state[key] = value;
        return Promise.resolve();
      },
    };

    // Mock secrets
    const secrets: Record<string, string> = {};
    secretsStub = {
      get: (key: string) => Promise.resolve(secrets[key]),
      store: (key: string, value: string) => {
        secrets[key] = value;
        return Promise.resolve();
      },
      delete: (key: string) => {
        delete secrets[key];
        return Promise.resolve();
      },
      onDidChange: new vscode.EventEmitter<void>().event,
    };

    context = {
      globalState: globalStateStub,
      secrets: secretsStub,
    } as any;

    connectionManager = new ConnectionManager(context);
  });

  it('Save and Get Connection', async () => {
    await connectionManager.saveConnection(mockProfile);

    const connections = await connectionManager.getConnections();
    assert.strictEqual(connections.length, 1);
    const saved = connections[0] as TrinoConnectionProfile;
    assert.ok(saved);
    assert.strictEqual(saved.id, mockProfile.id);
    assert.strictEqual(saved.user, mockProfile.user);
    // Password should NOT be in global state
    assert.strictEqual(saved.password, undefined);

    const retrievedProfile = await connectionManager.getConnection(mockProfile.id);
    assert.ok(retrievedProfile);
    assert.strictEqual(retrievedProfile?.password, mockProfile.password);
  });

  it('Update Existing Connection', async () => {
    await connectionManager.saveConnection(mockProfile);

    const updatedProfile = { ...mockProfile, user: 'new-user', password: 'new-password' };
    await connectionManager.saveConnection(updatedProfile);

    const connections = await connectionManager.getConnections();
    assert.strictEqual(connections.length, 1);
    const saved = connections[0] as TrinoConnectionProfile;
    assert.ok(saved);
    assert.strictEqual(saved.user, 'new-user');

    const retrieved = await connectionManager.getConnection(mockProfile.id);
    assert.strictEqual(retrieved?.password, 'new-password');
  });

  it('Delete Connection', async () => {
    await connectionManager.saveConnection(mockProfile);
    await connectionManager.deleteConnection(mockProfile.id);

    const connections = await connectionManager.getConnections();
    assert.strictEqual(connections.length, 0);

    const retrieved = await connectionManager.getConnection(mockProfile.id);
    assert.strictEqual(retrieved, undefined);
  });

  it('Update Password Directly', async () => {
    await connectionManager.saveConnection(mockProfile);

    await connectionManager.updatePassword(mockProfile.id, 'updated-password');

    const retrieved = await connectionManager.getConnection(mockProfile.id);
    assert.strictEqual(retrieved?.password, 'updated-password');
  });

  it('Clear Password Directly', async () => {
    await connectionManager.saveConnection(mockProfile);

    await connectionManager.clearPasswordForConnection(mockProfile.id);

    const retrieved = await connectionManager.getConnection(mockProfile.id);
    assert.strictEqual(retrieved?.password, undefined);
  });

  it('Save Connection with Empty Password Clears It', async () => {
    await connectionManager.saveConnection(mockProfile);

    // Save with empty password
    const updatedProfile = { ...mockProfile, password: '' };
    await connectionManager.saveConnection(updatedProfile);

    const retrieved = await connectionManager.getConnection(mockProfile.id);
    // Ideally this should be undefined or empty string, but currently it keeps the old password
    // We assert stricter expectation: it SHOULD be cleared (undefined)
    assert.strictEqual(
      retrieved?.password,
      undefined,
      'Password should be cleared when saving empty string'
    );
  });
});
