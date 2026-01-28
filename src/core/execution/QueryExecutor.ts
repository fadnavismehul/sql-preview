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
    private readonly daemonClient: DaemonClient
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

        const info = await this.daemonClient.getTabInfo(remoteTabId, currentOffset);
        // info structure: { id, title, status, columns, rows, error, ... }

        if (info.status === 'error') {
          throw new Error(info.error || 'Unknown daemon error');
        }

        const newRows = info.rows || [];
        if (newRows.length > 0) {
          currentOffset += newRows.length;
          yield {
            columns: info.columns,
            data: newRows,
            stats: {
              state: info.status === 'success' ? 'FINISHED' : 'RUNNING',
              rowCount: info.rowCount,
            },
          };
        } else if (info.columns && currentOffset === 0) {
          // Yield columns even if no rows yet
          yield {
            columns: info.columns,
            data: [],
            stats: {
              state: 'RUNNING',
              rowCount: 0,
            },
          };
        }

        if (info.status === 'success') {
          isDone = true;
        } else {
          // Still loading, wait a bit
          await new Promise(r => setTimeout(r, 200));
        }
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
