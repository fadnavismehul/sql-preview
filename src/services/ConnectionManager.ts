import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionProfile } from '../common/types';
import { Logger } from '../core/logging/Logger';

export class ConnectionManager {
  private static readonly STORAGE_KEY = 'sqlPreview.connections';
  private static readonly PASSWORD_KEY_PREFIX = 'sqlPreview.password.';

  constructor(private readonly context: vscode.ExtensionContext) { }

  public async getConnections(): Promise<ConnectionProfile[]> {
    const connections = this.context.globalState.get<ConnectionProfile[]>(
      ConnectionManager.STORAGE_KEY,
      []
    );
    return connections;
  }

  public async saveConnection(profile: ConnectionProfile): Promise<void> {
    const connections = await this.getConnections();
    const index = connections.findIndex(c => c.id === profile.id);

    // Don't persist password in globalState
    // Remove password from profile before saving to state
    const { password, ...safeProfile } = profile;

    if (index !== -1) {
      connections[index] = safeProfile as ConnectionProfile;
    } else {
      connections.push(safeProfile as ConnectionProfile);
    }

    await this.context.globalState.update(ConnectionManager.STORAGE_KEY, connections);

    if (password !== undefined) {
      if (password) {
        await this.setPassword(profile.id, password);
      } else {
        // Clear password if empty string provided
        await this.deletePassword(profile.id);
      }
    }

    // Sync to Daemon
    this.syncToDaemon(connections);
  }

  public async deleteConnection(id: string): Promise<void> {
    let connections = await this.getConnections();
    connections = connections.filter(c => c.id !== id);
    await this.context.globalState.update(ConnectionManager.STORAGE_KEY, connections);
    this.syncToDaemon(connections);
    await this.deletePassword(id);
  }

  public async getConnection(id: string): Promise<ConnectionProfile | undefined> {
    const connections = await this.getConnections();
    const profile = connections.find(c => c.id === id);
    if (profile) {
      const password = await this.getPassword(id);
      return { ...profile, ...(password ? { password } : {}) };
    }
    return undefined;
  }

  public async updatePassword(id: string, password: string): Promise<void> {
    await this.setPassword(id, password);
  }

  public async clearPasswordForConnection(id: string): Promise<void> {
    await this.deletePassword(id);
  }

  // --- Secret Storage ---

  private async getPassword(id: string): Promise<string | undefined> {
    return await this.context.secrets.get(`${ConnectionManager.PASSWORD_KEY_PREFIX}${id}`);
  }

  private async setPassword(id: string, password: string): Promise<void> {
    await this.context.secrets.store(`${ConnectionManager.PASSWORD_KEY_PREFIX}${id}`, password);
  }

  private async deletePassword(id: string): Promise<void> {
    await this.context.secrets.delete(`${ConnectionManager.PASSWORD_KEY_PREFIX}${id}`);
  }

  // --- Fallback ---

  public async getWorkspaceFallbackProfile(): Promise<ConnectionProfile | undefined> {
    const config = vscode.workspace.getConfiguration('sqlPreview');
    const connectorType = config.get<string>('defaultConnector', 'trino');

    if (connectorType === 'sqlite') {
      return {
        id: 'workspace-fallback-sqlite',
        name: 'Workspace SQLite',
        type: 'sqlite',
        databasePath: config.get<string>('databasePath', ''),
      } as import('../common/types').SQLiteConnectionProfile;
    } else {
      const legacyPassword = await this.context.secrets.get('sqlPreview.database.password');
      const catalog = config.get<string>('catalog');
      const schema = config.get<string>('schema');

      return {
        id: 'workspace-fallback-trino',
        name: 'Workspace Trino',
        type: 'trino',
        host: config.get<string>('host', 'localhost'),
        port: config.get<number>('port', 8080),
        user: config.get<string>('user', 'user'),
        ...(catalog ? { catalog } : {}),
        ...(schema ? { schema } : {}),
        ssl: config.get<boolean>('ssl', false),
        sslVerify: config.get<boolean>('sslVerify', true),
        ...(legacyPassword ? { password: legacyPassword } : {}),
      } as import('../common/types').TrinoConnectionProfile;
    }
  }

  // --- Migration ---

  public async migrateLegacySettings(): Promise<void> {
    const connections = await this.getConnections();
    // If we already have connections, assume migration is done or not needed
    if (connections.length > 0) {
      return;
    }

    const config = vscode.workspace.getConfiguration('sqlPreview');
    const connectorType = config.get<string>('defaultConnector', 'trino');

    if (connectorType === 'sqlite') {
      const defaultProfile: import('../common/types').SQLiteConnectionProfile = {
        id: 'default-sqlite-' + Date.now(),
        name: 'Default SQLite',
        type: 'sqlite',
        databasePath: config.get<string>('databasePath', ''),
      };
      await this.saveConnection(defaultProfile);
    } else {
      // Retrieve legacy password using exposed key string from AuthManager
      const legacyPassword = await this.context.secrets.get('sqlPreview.database.password');

      // Create Default Profile
      const id = 'default-trino-' + Date.now();

      const catalog = config.get<string>('catalog');
      const schema = config.get<string>('schema');

      const defaultProfile: import('../common/types').TrinoConnectionProfile = {
        id,
        name: 'Default Connection (Imported)',
        type: 'trino',
        host: config.get<string>('host', 'localhost'),
        port: config.get<number>('port', 8080),
        user: config.get<string>('user', 'user'),
        ...(catalog ? { catalog } : {}),
        ...(schema ? { schema } : {}),
        ssl: config.get<boolean>('ssl', false),
        sslVerify: config.get<boolean>('sslVerify', true),
        ...(legacyPassword ? { password: legacyPassword } : {}),
      } as import('../common/types').TrinoConnectionProfile;

      if (defaultProfile.password) {
        await this.saveConnection(defaultProfile);
      } else {
        // Save without password field if undefined
        // Save without password field if undefined
        const { password, ...safeProfile } = defaultProfile;
        void password;
        await this.saveConnection(safeProfile);
      }
    }

    // Optional: clear legacy password?
    // Better to leave it for safety in case they downgrade.
  }

  // --- Daemon Sync ---

  private getDaemonConfigPath(): string {
    const homeDir = os.homedir();

    // Check for Dev Port override logic mirroring DaemonClient
    const envPort = process.env['SQL_PREVIEW_MCP_PORT'];
    const configDir = envPort
      ? path.join(homeDir, '.sql-preview-debug')
      : path.join(homeDir, '.sql-preview');

    return path.join(configDir, 'config.json');
  }

  public async sync(): Promise<void> {
    const connections = await this.getConnections();
    this.syncToDaemon(connections);
  }

  private syncToDaemon(connections: ConnectionProfile[]) {
    try {
      const configPath = this.getDaemonConfigPath();

      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Read existing to preserve any manual secrets if possible?
      // For now, simple overwrite of profiles. Daemon FileConnectionManager is simple.
      // We strip passwords before writing (security).
      const safeConnections = connections.map(c => {
        const { password, ...rest } = c;
        void password;
        return rest;
      });

      fs.writeFileSync(
        configPath,
        JSON.stringify({ connections: safeConnections }, null, 2),
        'utf8'
      );
    } catch (e) {
      // Ignore sync errors (e.g. permission)
      Logger.getInstance().error(
        `Failed to sync connections to daemon: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}
