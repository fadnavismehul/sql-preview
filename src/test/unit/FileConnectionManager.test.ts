/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { FileConnectionManager } from '../../server/FileConnectionManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TrinoConnectionProfile } from '../../common/types';

// The fs mock in setup.ts is global, but we can override implementations per test file or test case
// if we use jest.mock/jest.spyOn properly, or just rely on the existing mock structure if it allows updates.
// Looking at setup.ts, it uses jest.mock('fs', ...).
// Since we are in a separate file, we might needed to re-mock or use the mocked instance methods.

// However, setup.ts is executed via `jest.config.js` or `runTest.ts` usually.
// If this is a unit test run via `jest`, setup.ts might be imported or global.
// Let's assume standard jest behavior where we can refine mocks.

// We need to re-mock fs for this test file to have control over it
jest.mock('fs');
jest.mock('os');

describe('FileConnectionManager', () => {
  let manager: FileConnectionManager;
  let mockDiskState: Record<string, string> = {};
  const mockHomeDir = '/mock/home';

  beforeEach(() => {
    mockDiskState = {};
    (os.homedir as jest.Mock).mockReturnValue(mockHomeDir);

    // Reset fs mocks
    (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
      return Object.prototype.hasOwnProperty.call(mockDiskState, path) || path === mockHomeDir;
    });

    (fs.mkdirSync as jest.Mock).mockImplementation(() => undefined);

    (fs.writeFileSync as jest.Mock).mockImplementation((path: string, content: string) => {
      mockDiskState[path] = content;
    });

    (fs.readFileSync as jest.Mock).mockImplementation((path: string) => {
      if (mockDiskState[path]) {
        return mockDiskState[path];
      }
      throw new Error('File not found');
    });

    manager = new FileConnectionManager();
  });

  const configPath = path.join(mockHomeDir, '.sql-preview', 'config.json');

  it('should create default config if it does not exist', () => {
    // manager constructor calls ensureConfigExists
    // We need to re-instantiate to test the constructor logic properly if we want to spy on it
    // But checking the state is enough.

    expect(fs.existsSync(configPath)).toBe(true);
    expect(JSON.parse(mockDiskState[configPath]!).connections).toEqual([]);
  });

  it('should save a connection profile', async () => {
    const profile: TrinoConnectionProfile = {
      id: 'conn1',
      name: 'Test',
      type: 'trino',
      host: 'localhost',
      port: 8080,
      user: 'admin',
      password: 'secretPassword',
      ssl: false,
    };

    await manager.saveConnection(profile);

    const config = JSON.parse(mockDiskState[configPath]!);
    expect(config.connections.length).toBe(1);
    expect(config.connections[0].id).toBe('conn1');
    expect(config.connections[0].password).toBeUndefined(); // Should not persist to disk

    // Check in-memory password retrieval
    const retrieved = await manager.getConnection('conn1');
    expect((retrieved as any).password).toBe('secretPassword');
  });

  it('should update an existing connection', async () => {
    const profile: TrinoConnectionProfile = {
      id: 'conn1',
      name: 'Test',
      type: 'trino',
      host: 'localhost',
      port: 8080,
      user: 'admin',
      ssl: false,
    };
    await manager.saveConnection(profile);

    const updatedProfile = { ...profile, user: 'updated_user' };
    await manager.saveConnection(updatedProfile);

    const config = JSON.parse(mockDiskState[configPath]!);
    expect(config.connections.length).toBe(1);
    expect(config.connections[0].user).toBe('updated_user');
  });

  it('should delete a connection', async () => {
    const profile: TrinoConnectionProfile = {
      id: 'conn1',
      name: 'Test',
      type: 'trino',
      host: 'localhost',
      port: 8080,
      user: 'admin',
      password: 'secret',
      ssl: false,
    };
    await manager.saveConnection(profile);

    await manager.deleteConnection('conn1');

    const config = JSON.parse(mockDiskState[configPath]!);
    expect(config.connections.length).toBe(0);

    // Password should be gone from memory
    const retrieved = await manager.getConnection('conn1');
    expect(retrieved).toBeUndefined();
  });

  it('should handle read errors gracefully', async () => {
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error('Read error');
    });

    const connections = await manager.getConnections();
    expect(connections).toEqual([]);
  });
});
