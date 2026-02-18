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

    // Smart Routing Strategy:
    // If no specific connection ID was requested (adhoc query),
    // and the query looks like a file query (FROM '...'),
    // we should prioritize DuckDB over the default fallback connection (e.g. Trino).
    if (!connectionId && !connectionOverride) {
      // Only match single-quoted strings (DuckDB file paths).
      // Double quotes (") are for identifiers (tables) in standard SQL (Trino), so we avoid capturing those.
      const fileQueryRegex = /from\s+'[^']+'/i;
      if (fileQueryRegex.test(query)) {
        try {
          // Check availability
          this.getConnector('duckdb');
          this.logger.info('Detected local file query pattern, switching to Adhoc DuckDB profile');
          profile = {
            id: 'adhoc-duckdb',
            name: 'Adhoc DuckDB',
            type: 'duckdb',
            databasePath: ':memory:',
            sslVerify: true,
          } as any;
        } catch (e) {
          this.logger.warn('DuckDB connector not available for file query auto-routing');
        }
      }
    }

    // Smart Routing: If no profile selected, check if query looks like a local file query
    // and route to DuckDB if available.
    if (!profile) {
      const fileQueryRegex = /FROM\s+['"][^'"]+['"]/i;
      if (fileQueryRegex.test(query)) {
        this.logger.info('Detected local file query, using Adhoc DuckDB profile');

        // Check if DuckDB connector is available
        try {
          this.getConnector('duckdb');
          profile = {
            id: 'adhoc-duckdb',
            name: 'Adhoc DuckDB',
            type: 'duckdb',
            databasePath: ':memory:',
          } as any;
        } catch (e) {
          this.logger.warn('DuckDB connector not available for file query auto-routing');
        }
      }
    }

    if (!profile) {
      // Fallback to first available connection logic MOVED here or kept above?
      // The original logic checked connectionId OR fell back.
      // If I insert my logic before the "No valid connection profile found" check, it works.
      // But wait, the original code had a fallback block inside the `else` of `if (connectionId)`.
      // Let's restructure slightly to be cleaner.
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
