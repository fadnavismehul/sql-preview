import * as vscode from 'vscode';
import { ConnectionProfile } from '../common/types';

export class ConnectionManager {
  private static readonly STORAGE_KEY = 'sqlPreview.connections';
  private static readonly PASSWORD_KEY_PREFIX = 'sqlPreview.password.';

  constructor(private readonly context: vscode.ExtensionContext) {}

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
    const { password, ...safeProfile } = profile;

    if (index !== -1) {
      connections[index] = safeProfile as ConnectionProfile;
    } else {
      connections.push(safeProfile as ConnectionProfile);
    }

    await this.context.globalState.update(ConnectionManager.STORAGE_KEY, connections);

    if (password) {
      await this.setPassword(profile.id, password);
    }
  }

  public async deleteConnection(id: string): Promise<void> {
    let connections = await this.getConnections();
    connections = connections.filter(c => c.id !== id);
    await this.context.globalState.update(ConnectionManager.STORAGE_KEY, connections);
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

  // --- Migration ---

  public async migrateLegacySettings(): Promise<void> {
    const connections = await this.getConnections();
    // If we already have connections, assume migration is done or not needed
    if (connections.length > 0) {
      return;
    }

    const config = vscode.workspace.getConfiguration('sqlPreview');

    // Basic check to see if there is meaningful config to migrate
    // If users have default 'localhost' we still migrate it to a default profile
    // to ensure the UI is not empty.

    // Retrieve legacy password using exposed key string from AuthManager (or hardcoded string to avoid circular dependency if AuthManager logic changes)
    // Hardcoding the key here to avoid depending on AuthManager's internal constant which might change for new implementation
    const legacyPassword = await this.context.secrets.get('sqlPreview.database.password');

    // Create Default Profile
    // Import crypto for UUID if available, or simple random string
    const id = 'default-trino-' + Date.now();

    const defaultProfile: any = {
      // using any momentarily to avoid strict type issues with discriminators if types are strict
      id,
      name: 'Default Connection (Imported)',
      type: 'trino',
      host: config.get<string>('host', 'localhost'),
      port: config.get<number>('port', 8080),
      user: config.get<string>('user', 'user'),
      catalog: config.get<string>('catalog') || undefined,
      schema: config.get<string>('schema') || undefined,
      ssl: config.get<boolean>('ssl', false),
      sslVerify: config.get<boolean>('sslVerify', true),
      password: legacyPassword,
    };

    if (defaultProfile.password) {
      await this.saveConnection(defaultProfile);
    } else {
      // Save without password field if undefined
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...safeProfile } = defaultProfile;
      await this.saveConnection(safeProfile);
    }

    // Optional: clear legacy password?
    // Better to leave it for safety in case they downgrade.
  }
}
