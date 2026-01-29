import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConnectionProfile } from '../common/types';
import { logger } from './ConsoleLogger';

export interface ServerConfig {
  connections: ConnectionProfile[];
}

export class FileConnectionManager {
  private configPath: string;
  private inMemoryPasswords = new Map<string, string>();

  constructor() {
    const homeDir = os.homedir();
    this.configPath = path.join(homeDir, '.sql-preview', 'config.json');
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

  public async getConnections(): Promise<ConnectionProfile[]> {
    const config = this.readConfig();
    return config.connections;
  }

  public async getConnection(id: string): Promise<ConnectionProfile | undefined> {
    const connections = await this.getConnections();
    const profile = connections.find(c => c.id === id);
    if (profile) {
      const password = this.inMemoryPasswords.get(id);
      return { ...profile, ...(password ? { password } : {}) };
    }
    return undefined;
  }

  public async saveConnection(profile: ConnectionProfile): Promise<void> {
    const config = this.readConfig();
    const index = config.connections.findIndex(c => c.id === profile.id);

    // Extract password to store separately (in memory for now)
    const { password, ...safeProfile } = profile;

    // In a real implementation, we might use keytar here if available
    if (password) {
      this.inMemoryPasswords.set(profile.id, password);
    }

    if (index !== -1) {
      config.connections[index] = safeProfile as ConnectionProfile;
    } else {
      config.connections.push(safeProfile as ConnectionProfile);
    }

    this.writeConfig(config);
  }

  public async deleteConnection(id: string): Promise<void> {
    const config = this.readConfig();
    config.connections = config.connections.filter(c => c.id !== id);
    this.writeConfig(config);
    this.inMemoryPasswords.delete(id);
  }

  public setPasswordForSession(id: string, password: string) {
    this.inMemoryPasswords.set(id, password);
  }
}
