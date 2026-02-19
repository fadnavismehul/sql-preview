import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConnectionProfile } from '../../common/types';
import { IProfileStore } from './interfaces';
import { logger } from '../ConsoleLogger';

interface ServerConfig {
  connections: ConnectionProfile[];
}

export class FileProfileStore implements IProfileStore {
  private configPath: string;
  public readonly isReadOnly = false;

  constructor(configDir?: string) {
    const homeDir = os.homedir();
    const baseDir =
      configDir || process.env['SQL_PREVIEW_HOME'] || path.join(homeDir, '.sql-preview');
    this.configPath = path.join(baseDir, 'config.json');
    this.ensureConfigExists();
  }

  private ensureConfigExists() {
    if (!fs.existsSync(this.configPath)) {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.writeConfig({ connections: [] });
    }
  }

  private readConfig(): ServerConfig {
    try {
      if (!fs.existsSync(this.configPath)) {
        return { connections: [] };
      }
      const raw = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      logger.error('Failed to read config:', error);
      return { connections: [] };
    }
  }

  private writeConfig(config: ServerConfig) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  public async loadProfiles(): Promise<ConnectionProfile[]> {
    const config = this.readConfig();
    return config.connections;
  }

  public async saveProfile(profile: ConnectionProfile): Promise<void> {
    const config = this.readConfig();
    const index = config.connections.findIndex(c => c.id === profile.id);

    // Security: Ensure we don't accidentally persist passwords in the file store
    // The Manager should handle stripping them, but we do it here as a safety net.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...safeProfile } = profile;

    if (index !== -1) {
      config.connections[index] = safeProfile as ConnectionProfile;
    } else {
      config.connections.push(safeProfile as ConnectionProfile);
    }

    this.writeConfig(config);
  }

  public async deleteProfile(id: string): Promise<void> {
    const config = this.readConfig();
    const initialLength = config.connections.length;
    config.connections = config.connections.filter(c => c.id !== id);

    if (config.connections.length !== initialLength) {
      this.writeConfig(config);
    }
  }
}
