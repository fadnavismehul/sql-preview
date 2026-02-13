import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import * as http from 'http';
import axios from 'axios';
import {
  TabData,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from '../../../common/types';
import { TabManager } from '../../../services/TabManager';
import { ExportService } from '../../../services/ExportService';
import { QuerySessionRegistry } from '../../../services/QuerySessionRegistry';
import { ConnectionManager } from '../../../services/ConnectionManager';
import { QueryExecutor } from '../../../core/execution/QueryExecutor';
import { Logger } from '../../../core/logging/Logger';
import { validatePort } from '../../../utils/validation';

export interface MessageHandlerDelegate {
  postMessage(message: ExtensionToWebviewMessage): void;
  restoreTabs(): void;
  refreshSettings(): Promise<void>;
  filterTabsByFile(fileUri: string | undefined): void;
  getActiveEditorUri(): string | undefined;
  closeTab(tabId: string): Promise<void>;
  saveState?(): Promise<void>;
}

export class ResultsMessageHandler {
  constructor(
    private readonly _delegate: MessageHandlerDelegate,
    private readonly _tabManager: TabManager,
    private readonly _exportService: ExportService,
    private readonly _querySessionRegistry: QuerySessionRegistry,
    private readonly _connectionManager: ConnectionManager,
    private readonly _queryExecutor: QueryExecutor,
    private readonly _extensionUri: vscode.Uri
  ) {}

  public async handleMessage(data: WebviewToExtensionMessage) {
    switch (data.command) {
      case 'alert':
        vscode.window.showInformationMessage(data.text);
        return;
      case 'createNewTab':
        vscode.commands.executeCommand('sql.runQueryNewTab');
        return;
      case 'lockMcpPort': {
        const port = validatePort(data.port);
        const target = vscode.ConfigurationTarget.Workspace;
        await vscode.workspace.getConfiguration('sqlPreview').update('mcpPort', port, target);
        vscode.window.showInformationMessage(`MCP Port locked to ${port} for this workspace.`);
        return;
      }
      case 'webviewLoaded': {
        this._delegate.restoreTabs();
        const activeUri = this._delegate.getActiveEditorUri();
        if (activeUri) {
          this._delegate.filterTabsByFile(activeUri);
        }
        // Send current row height setting
        const config = vscode.workspace.getConfiguration('sqlPreview');
        const density = config.get<string>('rowHeight', 'normal');
        this._delegate.postMessage({ type: 'updateRowHeight', density });
        // eslint-disable-next-line no-console
        this._refreshConnections().catch(err => this.log(String(err)));
        this._checkLatestVersion().catch(err => this.log(`Error checking version: ${err}`));
        return;
      }
      case 'openExtensionPage':
        vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithIds', [
          'mehul.sql-preview',
        ]);
        return;

      case 'tabClosed':
        this.log(`Tab closed: ${data.tabId}`);
        await this._delegate.closeTab(data.tabId);
        return;

      case 'updateTabState': {
        const updates: Partial<TabData> = {};
        if (data.title) {
          updates.title = data.title;
        }
        if (data.query) {
          updates.query = data.query;
        }
        this._tabManager.updateTab(data.tabId, updates);
        if (this._delegate.saveState) {
          await this._delegate.saveState();
        }
        return;
      }
      case 'tabSelected':
        this._tabManager.setActiveTab(data.tabId);
        if (this._delegate.saveState) {
          await this._delegate.saveState();
        }
        return;
      case 'exportResults': {
        const tab = this._tabManager.getTab(data.tabId);
        if (tab) {
          this._exportService.exportResults(tab);
        }
        return;
      }
      case 'cancelQuery': {
        this.log(`Cancelling query for tab: ${data.tabId}`);
        try {
          this._querySessionRegistry.cancelSession(data.tabId);
          this.log(`Cancellation signal sent for tab: ${data.tabId}`);
        } catch (e) {
          this.log(`Error cancelling session: ${e}`);
        }
        return;
      }
      case 'testConnection': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const config = data.config as any; // config is typed as unknown in message definition for flexibility

        const workspaceConfig = vscode.workspace.getConfiguration('sqlPreview');
        const connectorType =
          config.defaultConnector || workspaceConfig.get<string>('defaultConnector', 'trino');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let testConfig: any;
        let authHeader: string | undefined;

        if (connectorType === 'sqlite') {
          testConfig = {
            databasePath: config.databasePath,
          };
          // SQLite doesn't use auth header usually
        } else {
          // Trino
          testConfig = {
            host: config.host,
            port: validatePort(config.port),
            user: config.user,
            catalog: config.catalog,
            schema: config.schema,
            ssl: config.ssl,
            sslVerify: config.sslVerify,
            maxRows: 1,
          };

          // Try to retrieve password for default profile
          const connections = await this._connectionManager.getConnections();
          // Logic matches saveSettings: use first existing or generate default ID (though generating new one won't have password)
          // If no connections exist, we can't find a password. User must have saved or set password.
          if (connections.length > 0) {
            const profileId = connections[0]?.id; // Assumption: Single default profile for now
            if (profileId) {
              const fullProfile = await this._connectionManager.getConnection(profileId);
              if (fullProfile && fullProfile.password) {
                const password = fullProfile.password;
                authHeader =
                  'Basic ' + Buffer.from(`${config.user}:${password}`).toString('base64');
              }
            }
          }
        }

        const result = await this._queryExecutor.testConnection(
          connectorType,
          testConfig,
          authHeader
        );
        this._delegate.postMessage({
          type: 'testConnectionResult',
          success: result.success,
          ...(result.error ? { error: result.error } : {}),
        } as ExtensionToWebviewMessage);
        return;
      }
      case 'refreshSettings': {
        await this._delegate.refreshSettings();
        return;
      }
      case 'testMcpServer': {
        // Check Daemon Health
        const config = vscode.workspace.getConfiguration('sqlPreview');
        const envPort = process.env['SQL_PREVIEW_MCP_PORT'];
        const configPort = config.get<number>('mcpPort', 8414);

        // Prefer port sent from UI, then Env Var, then Config
        let rawPort = data.port;
        if (!rawPort) {
          rawPort = envPort ? parseInt(envPort, 10) : configPort;
        }
        const port = validatePort(rawPort);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const req = http.get(`http://localhost:${port}/status`, (res: any) => {
          if (res.statusCode === 200) {
            this._delegate.postMessage({
              type: 'testMcpResult',
              success: true,
              message: 'Server is running and reachable.',
            });
          } else {
            this._delegate.postMessage({
              type: 'testMcpResult',
              success: false,
              error: `Server responded with HTTP ${res.statusCode}`,
            });
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req.on('error', (e: any) => {
          this._delegate.postMessage({
            type: 'testMcpResult',
            success: false,
            error: `Connection Failed: ${e.message}. Ensure Server is running.`,
          });
        });

        req.end();
        return;
      }
      case 'saveSettings': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = data.settings as any;

        let resource: vscode.Uri | undefined;
        const activeUri = this._delegate.getActiveEditorUri();
        if (activeUri) {
          try {
            resource = vscode.Uri.parse(activeUri);
          } catch (e) {
            // Ignore invalid URIs
          }
        } else {
          const folders = vscode.workspace.workspaceFolders;
          if (folders && folders.length > 0) {
            resource = folders[0]?.uri;
          }
        }

        const config = vscode.workspace.getConfiguration('sqlPreview', resource);

        // Helper to write to correct target (Global Default, Workspace Override Maintenance)
        const writeConfig = async (key: string, value: unknown) => {
          const inspect = config.inspect(key);
          const target =
            inspect?.workspaceValue !== undefined
              ? vscode.ConfigurationTarget.Workspace
              : vscode.ConfigurationTarget.Global;
          await config.update(key, value, target);
        };

        // Batch updates
        await Promise.all([
          writeConfig('maxRowsToDisplay', s.maxRowsToDisplay),
          writeConfig('fontSize', s.fontSize),
          writeConfig('rowHeight', s.rowHeight),
          writeConfig('tabNaming', s.tabNaming),

          writeConfig('host', s.host),
          writeConfig('port', s.port ? validatePort(s.port) : undefined),
          writeConfig('user', s.user),
          writeConfig('catalog', s.catalog),
          writeConfig('schema', s.schema),
          writeConfig('ssl', s.ssl),
          writeConfig('sslVerify', s.sslVerify),

          writeConfig('mcpEnabled', s.mcpEnabled),
          writeConfig('mcpPort', s.mcpPort ? validatePort(s.mcpPort) : undefined),
          writeConfig('defaultConnector', s.defaultConnector),
          writeConfig('databasePath', s.databasePath),
        ]);

        // Sync with ConnectionManager (Default Profile)
        const existing = await this._connectionManager.getConnections();
        const profileId =
          existing.length > 0 && existing[0] ? existing[0].id : 'default-' + Date.now();

        let profile: import('../../../common/types').ConnectionProfile;
        if (s.defaultConnector === 'sqlite') {
          profile = {
            id: profileId,
            name: 'Default Connection',
            type: 'sqlite',
            databasePath: s.databasePath || '',
          } as import('../../../common/types').SQLiteConnectionProfile;
        } else {
          profile = {
            id: profileId,
            name: 'Default Connection',
            type: 'trino',
            host: s.host || '127.0.0.1',
            port: s.port ? validatePort(s.port) : 8080,
            user: s.user || 'user',
            catalog: s.catalog,
            schema: s.schema,
            ssl: s.ssl || false,
            sslVerify: s.sslVerify !== false,
          };
        }
        await this._connectionManager.saveConnection(profile);
        // Note: saveConnection preserves existing password via simple merge check or secrets logic
        // But here we construct a new object. saveConnection implementation handles merging?
        // Checking ConnectionManager: it receives the profile. It does NOT merge "password" from retrieval unless provided.
        // But we want to PRESERVE password if it exists.
        // Wait, ConnectionManager.saveConnection splits password.
        // If we pass a profile WITHOUT password field, does it delete it?
        // "if (password !== undefined)" -> checks field presence.
        // In our constructing above, 'password' key is missing (undefined).
        // So saveConnection(profile) where password is undefined => It will NOT touch the secret. Correct.

        // Refresh settings to confirm
        this._delegate.refreshSettings(); // This will fetch stored password status

        vscode.window.setStatusBarMessage('SQL Preview settings saved.', 2000);
        return;
      }
      case 'setPassword': {
        const password = await vscode.window.showInputBox({
          prompt: 'Enter Database Password',
          password: true,
          placeHolder: 'Password will be stored securely in VS Code Secret Storage',
        });

        if (password !== undefined && password.length > 0) {
          const existing = await this._connectionManager.getConnections();
          // Ensure a profile exists
          let profileId: string;
          if (existing.length === 0) {
            // Should create one first?
            // Quick fix: create a default one with default settings
            profileId = 'default-' + Date.now();
            // We need some minimal config.
            const defaultProfile: import('../../../common/types').TrinoConnectionProfile = {
              id: profileId,
              name: 'Default Connection',
              type: 'trino',
              host: '127.0.0.1',
              port: 8080,
              user: 'user',
              ssl: false,
              sslVerify: true,
            };
            await this._connectionManager.saveConnection(defaultProfile);
          } else {
            profileId = existing[0] ? existing[0].id : '';
            if (!profileId) {
              throw new Error('No profile found');
            }
          }

          await this._connectionManager.updatePassword(profileId, password);
          vscode.window.showInformationMessage('Password saved securely.');
          this._delegate.refreshSettings();
        }
        return;
      }
      case 'clearPassword': {
        const existing = await this._connectionManager.getConnections();
        if (existing.length > 0 && existing[0]) {
          await this._connectionManager.clearPasswordForConnection(existing[0].id);
          vscode.window.showInformationMessage('Password cleared.');
          this._delegate.refreshSettings();
        }
        return;
      }
      case 'logMessage':
        this.log(`[Webview ${data.level.toUpperCase()}] ${data.message}`);
        return;
    }
  }

  private async _refreshConnections() {
    const connections = await this._connectionManager.getConnections();
    this._delegate.postMessage({ type: 'updateConnections', connections });
  }

  private async _checkLatestVersion() {
    try {
      // Get current version from package.json
      const packageJsonUri = vscode.Uri.joinPath(this._extensionUri, 'package.json');
      const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonUri);
      const packageJson = JSON.parse(new TextDecoder().decode(packageJsonContent));
      const currentVersion = packageJson.version;

      this._delegate.postMessage({
        type: 'updateVersionInfo',
        currentVersion,
        latestVersion: null, // Loading state
      });

      // Fetch latest version from VS Code Marketplace
      const response = await axios.post(
        'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
        {
          filters: [
            {
              criteria: [
                { filterType: 7, value: 'mehul.sql-preview' },
                { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
              ],
            },
          ],
          flags: 0x200, // Include latest version only
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json;api-version=3.0-preview.1',
          },
        }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = (response.data as any).results?.[0]?.extensions;
      if (results && results.length > 0) {
        const latestVersion = results[0].versions[0].version;
        this._delegate.postMessage({
          type: 'updateVersionInfo',
          currentVersion,
          latestVersion,
        });
      }
    } catch (e) {
      this.log(`Failed to check for updates: ${e}`);
    }
  }

  private log(message: string) {
    Logger.getInstance().info(message);
  }
}
