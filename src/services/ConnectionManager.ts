import * as vscode from 'vscode';
import { ConnectionProfile } from '../common/types';

import { DaemonClient } from './DaemonClient';

export class ConnectionManager {
  private static readonly PASSWORD_KEY_PREFIX = 'sqlPreview.password.';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly daemonClient: DaemonClient
  ) {}

  public async getConnections(): Promise<ConnectionProfile[]> {
    // Fetch from Daemon
    const daemonConnections = await this.daemonClient.listConnections();

    // Add Fallback Profile from Workspace Settings
    const fallback = await this.getWorkspaceFallbackProfile();
    if (fallback) {
      daemonConnections.push(fallback as any);
    }

    // Merge with local passwords
    const enriched = await Promise.all(
      daemonConnections.map(async (c: any) => {
        const password = await this.getPassword(c.id);
        if (password) {
          return { ...c, password };
        }
        return c;
      })
    );

    return enriched;
  }

  public async saveConnection(profile: ConnectionProfile): Promise<void> {
    // 1. Separate Password
    const { password, ...safeProfile } = profile;

    // 2. Save Profile to Daemon
    await this.daemonClient.saveConnection(safeProfile);

    // 3. Save Password to Secrets
    if (password !== undefined) {
      if (password) {
        await this.setPassword(profile.id, password);
      } else {
        await this.deletePassword(profile.id);
      }
    }
  }

  public async deleteConnection(id: string): Promise<void> {
    await this.daemonClient.deleteConnection(id);
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

  // --- Daemon Sync ---
  // (Obsolete)
}
