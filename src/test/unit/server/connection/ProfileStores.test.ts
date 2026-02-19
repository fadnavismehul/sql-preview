import { FileProfileStore } from '../../../../server/connection/FileProfileStore';
import { EnvProfileStore } from '../../../../server/connection/EnvProfileStore';
import { ConnectionProfile } from '../../../../common/types';
// import * as path from 'path'; // Unused
import * as fs from 'fs';

// Mock fs
jest.mock('fs');

describe('Profile Stores', () => {
  describe('FileProfileStore', () => {
    let store: FileProfileStore;
    const mockConfigDir = '/mock/config/dir';

    beforeEach(() => {
      jest.clearAllMocks();
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ connections: [] }));
      store = new FileProfileStore(mockConfigDir);
    });

    it('should load profiles from file', async () => {
      const mockProfiles: ConnectionProfile[] = [
        { id: '1', name: 'Test 1', type: 'trino', host: 'h', port: 1, user: 'u', ssl: false },
      ];
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ connections: mockProfiles }));

      const profiles = await store.loadProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.id).toBe('1');
    });

    it('should save a new profile', async () => {
      const newProfile: ConnectionProfile = {
        id: '2',
        name: 'Test 2',
        type: 'trino',
        host: 'h',
        port: 1,
        user: 'u',
        ssl: false,
      };
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ connections: [] }));

      await store.saveProfile(newProfile);

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writtenData = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls[0][1]);
      expect(writtenData.connections).toHaveLength(1);
      expect(writtenData.connections[0].id).toBe('2');
    });

    it('should update an existing profile', async () => {
      const existingProfile: ConnectionProfile = {
        id: '1',
        name: 'Old Name',
        type: 'trino',
        host: 'h',
        port: 1,
        user: 'u',
        ssl: false,
      };
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ connections: [existingProfile] })
      );

      const updatedProfile = { ...existingProfile, name: 'New Name' };
      await store.saveProfile(updatedProfile);

      const writtenData = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls[0][1]);
      expect(writtenData.connections).toHaveLength(1);
      expect(writtenData.connections[0].name).toBe('New Name');
    });

    it('should delete a profile', async () => {
      const existingProfile: ConnectionProfile = {
        id: '1',
        name: 'Test 1',
        type: 'trino',
        host: 'h',
        port: 1,
        user: 'u',
        ssl: false,
      };
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ connections: [existingProfile] })
      );

      await store.deleteProfile('1');

      const writtenData = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls[0][1]);
      expect(writtenData.connections).toHaveLength(0);
    });

    it('should initialize config file if not exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      new FileProfileStore(mockConfigDir);

      expect(fs.mkdirSync).toHaveBeenCalledWith(mockConfigDir, { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('EnvProfileStore', () => {
    let store: EnvProfileStore;
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
      store = new EnvProfileStore();
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should load profiles from environment variable', async () => {
      const mockProfiles: ConnectionProfile[] = [
        {
          id: 'env1',
          name: 'Env Test',
          type: 'postgres',
          host: 'h',
          port: 1,
          user: 'u',
          database: 'd',
          ssl: false,
        },
      ];
      process.env['SQL_PREVIEW_CONNECTIONS'] = JSON.stringify(mockProfiles);

      const profiles = await store.loadProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.id).toBe('env1');
    });

    it('should return empty array if env var is missing', async () => {
      delete process.env['SQL_PREVIEW_CONNECTIONS'];
      const profiles = await store.loadProfiles();
      expect(profiles).toHaveLength(0);
    });

    it('should return empty array if env var is invalid JSON', async () => {
      process.env['SQL_PREVIEW_CONNECTIONS'] = 'invalid-json';
      const profiles = await store.loadProfiles();
      expect(profiles).toHaveLength(0);
    });

    it('should throw error on save', async () => {
      await expect(store.saveProfile({} as any)).rejects.toThrow('read-only');
    });

    it('should throw error on delete', async () => {
      await expect(store.deleteProfile('id')).rejects.toThrow('read-only');
    });
  });
});
