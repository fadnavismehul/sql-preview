import * as vscode from 'vscode';
import { ConnectorRegistry } from '../../connectors/base/ConnectorRegistry';
import { QueryPage } from '../../common/types';
import { ConnectionManager } from '../../services/ConnectionManager';
import { DaemonClient } from '../../services/DaemonClient';
import { Logger } from '../logging/Logger';
import { ConnectorConfig } from '../../connectors/base/IConnector';

export class QueryExecutor {
  private logger = Logger.getInstance();

  constructor(
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly connectionManager: ConnectionManager,
    private readonly daemonClient: DaemonClient,
    private readonly driverManager: import('../../services/DriverManager').DriverManager
  ) {}

  /**
   * Orchestrates the query execution via Daemon.
   */
  async *execute(
    query: string,
    contextUri?: vscode.Uri,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown> {
    const correlationId = Math.random().toString(36).substring(7);
    this.logger.info(`Starting query execution via Daemon`, { query }, correlationId);

    // Resolve Connection Profile (Client Side) to pass to Daemon
    const connections = await this.connectionManager.getConnections();
    let profile: any = undefined;

    if (connections.length > 0) {
      // Fallback or Active logic
      const config = vscode.workspace.getConfiguration('sqlPreview', contextUri);
      const defaultType = config.get<string>('defaultConnector', 'trino');
      const matching = connections.find(c => c.type === defaultType);
      const active = matching || connections[0];

      if (active) {
        profile = await this.connectionManager.getConnection(active.id);
      }
    } else {
      profile = await this.connectionManager.getWorkspaceFallbackProfile();
    }

    // Inject Driver Path if needed (Extension Host Side)
    if (profile && (profile.type === 'sqlite' || profile.type === 'postgres')) {
      try {
        const packageName = profile.type === 'sqlite' ? 'sqlite3' : 'pg';
        const driverPath = await this.driverManager.getDriver(packageName);
        // Inject into profile for Daemon to use
        (profile as any).driverPath = driverPath;
      } catch (e) {
        this.logger.error(`Failed to resolve driver for ${profile.type}`, e);
        // We let it proceed, maybe it works if globally installed or bundled (fallback)
      }
    }

    try {
      // 1. Submit Query with Profile Override
      const remoteTabId = await this.daemonClient.runQuery(query, true, profile);

      // 2. Poll for Results
      let isDone = false;
      let currentOffset = 0;

      while (!isDone) {
        if (abortSignal?.aborted) {
          this.logger.info(`Abort signal detected for local query loop`);
          try {
            await this.daemonClient.cancelQuery(remoteTabId);
            this.logger.info(`Daemon cancel invoked for ${remoteTabId}`);
          } catch (e) {
            this.logger.error('Failed to cancel query', e);
          }
          return;
        }

        // Use a large limit for VS Code extension - it manages truncation itself in extension.ts
        const info = await this.daemonClient.getTabInfo(remoteTabId, currentOffset, 10000);
        // info structure: { id, title, status, columns, rows, error, hasMore, ... }

        if (info.status === 'error') {
          throw new Error(info.error || 'Unknown daemon error');
        }

        const newRows = info.rows || [];
        const isComplete = info.status === 'success';
        const hasMore = info.hasMore ?? false;

        // Determine if we should yield this iteration
        // We yield when:
        // 1. There are new rows to deliver
        // 2. Query just completed (final yield, even if empty - e.g., DELETE returning 0 rows)
        // 3. First poll with columns (to show grid structure before data arrives)
        const hasNewRows = newRows.length > 0;
        const isFirstPollWithColumns = info.columns && currentOffset === 0 && !hasNewRows;
        const isFinalEmptyResult = isComplete && currentOffset === 0 && !hasNewRows;

        if (hasNewRows || isFirstPollWithColumns || isFinalEmptyResult) {
          currentOffset += newRows.length;
          yield {
            columns: info.columns,
            data: newRows,
            supportsPagination: info.supportsPagination,
            stats: {
              state: isComplete && !hasMore ? 'FINISHED' : 'RUNNING',
              rowCount: info.rowCount ?? currentOffset,
            },
          };
        }

        // Only done when complete AND no more rows to fetch
        if (isComplete && !hasMore) {
          isDone = true;
        } else if (!hasNewRows && !hasMore) {
          // Still loading, wait a bit before polling again
          await new Promise(r => setTimeout(r, 200));
        }
        // If hasMore is true but isComplete is false, we continue immediately to fetch more
      }
    } catch (e: unknown) {
      this.logger.error(`Query execution failed`, e, correlationId);
      throw e;
    }
  }

  /**
   * Tests connectivity
   * TODO: Implement via Daemon
   */
  public async testConnection(
    type: string,
    config: ConnectorConfig,
    authHeader?: string
  ): Promise<{ success: boolean; error?: string }> {
    // Fallback to local check if possible, or fail
    // For now, let's just return true/false dummy or try local if we have connectors loaded locally?
    // ServiceContainer still loads connectors locally.
    // So we can fallback to local test for now!
    try {
      const connector = this.connectorRegistry.get(type);
      if (!connector) {
        throw new Error('Connector not found locally');
      }

      const valError = connector.validateConfig(config);
      if (valError) {
        return { success: false, error: valError };
      }

      if (connector.testConnection) {
        return await connector.testConnection(config, authHeader);
      }

      const iterator = connector.runQuery('SELECT 1', config, authHeader);
      await iterator.next();
      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    }
  }
}
