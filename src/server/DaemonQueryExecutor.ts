import { IConnector, ConnectorConfig } from '../connectors/base/IConnector';
import { ConnectorRegistry } from '../connectors/base/ConnectorRegistry';
import { QueryPage, ConnectionProfile } from '../common/types';
import { FileConnectionManager } from './FileConnectionManager';
import { ILogger } from '../common/logger';

export class DaemonQueryExecutor {
  constructor(
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly connectionManager: FileConnectionManager,
    private readonly logger: ILogger
  ) {}

  private getConnector(type: string): IConnector {
    const connector = this.connectorRegistry.get(type);
    if (!connector) {
      throw new Error(`Connector '${type}' not registered`);
    }
    return connector;
  }

  /**
   * Orchestrates the query execution.
   */
  async *execute(
    query: string,
    sessionId: string,
    connectionId?: string,
    abortSignal?: AbortSignal,
    connectionOverride?: ConnectionProfile
  ): AsyncGenerator<QueryPage, void, unknown> {
    this.logger.info(`Starting query execution for session ${sessionId}`, { query });

    let profile: ConnectionProfile | undefined;

    if (connectionOverride) {
      profile = connectionOverride;
    } else if (connectionId) {
      profile = await this.connectionManager.getConnection(connectionId);
    } else {
      // Fallback to first available connection
      this.logger.info(`Fetching connections for fallback...`);
      const connections = await this.connectionManager.getConnections();
      this.logger.info(`Found ${connections.length} connections.`);
      if (connections.length > 0 && connections[0]) {
        // Need to fetch full profile including password
        profile = await this.connectionManager.getConnection(connections[0].id);
      }
    }

    if (!profile) {
      this.logger.error('No valid connection profile found.');
      throw new Error('No valid connection profile found.');
    }

    // Generic Config Construction
    const connectorConfig: ConnectorConfig = {
      ...profile,
      maxRows: 1000, // TODO: Get from Daemon Config
      sslVerify:
        'sslVerify' in profile && profile.sslVerify !== undefined ? profile.sslVerify : true,
    };

    // Validation
    const connector = this.getConnector(profile.type);
    const validationError = connector.validateConfig(connectorConfig);
    if (validationError) {
      this.logger.error(`Configuration validation failed`, { error: validationError });
      throw new Error(`Configuration Error: ${validationError}`);
    }

    let authHeader: string | undefined;
    if ('password' in profile && profile.password && 'user' in profile) {
      authHeader = 'Basic ' + Buffer.from(`${profile.user}:${profile.password}`).toString('base64');
    }

    try {
      const generator = connector.runQuery(query, connectorConfig, authHeader, abortSignal);
      for await (const page of generator) {
        yield {
          ...page,
          supportsPagination: connector.supportsPagination,
        };
      }
      this.logger.info(`Query execution completed for session ${sessionId}`);
    } catch (e: unknown) {
      this.logger.error(`Query execution failed`, e);
      throw e;
    }
  }

  /**
   * Tests connectivity
   */
  public async testConnection(
    type: string,
    config: ConnectorConfig,
    authHeader?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const connector = this.getConnector(type);
      // Validate before running
      const valError = connector.validateConfig(config);
      if (valError) {
        return { success: false, error: valError };
      }

      const iterator = connector.runQuery('SELECT 1', config, authHeader);
      // Attempt to fetch first page to validate connection & auth
      await iterator.next();
      return { success: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    }
  }
}
