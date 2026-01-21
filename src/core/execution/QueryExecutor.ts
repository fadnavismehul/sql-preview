import * as vscode from 'vscode';
import { IConnector, ConnectorConfig } from '../../connectors/base/IConnector';
import { ConnectorRegistry } from '../../connectors/base/ConnectorRegistry';
import { QueryPage } from '../../common/types';
import { ConnectionManager } from '../../services/ConnectionManager'; // Referencing old service for now
import { Logger } from '../logging/Logger';

export class QueryExecutor {
  private logger = Logger.getInstance();

  constructor(
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly connectionManager: ConnectionManager
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
    contextUri?: vscode.Uri,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown> {
    const correlationId = Math.random().toString(36).substring(7);
    this.logger.info(`Starting query execution`, { query }, correlationId);

    // Resolve Connection Profile
    const connections = await this.connectionManager.getConnections();
    if (connections.length === 0) {
      throw new Error(
        "No connection profile found. Please add a connection in SQL Preview 'Connections' menu."
      );
    }

    // Use the first connection for now (Active Profile selection to be added)
    const firstConnection = connections[0];
    if (!firstConnection) {
      throw new Error('No connection profile found.');
    }
    const profile = await this.connectionManager.getConnection(firstConnection.id);
    if (!profile) {
      throw new Error('Failed to load connection profile.');
    }

    const config = vscode.workspace.getConfiguration('sqlPreview', contextUri);

    // Generic Config Construction: Spread profile properties
    // This allows any connector-specific fields (catalog, dbName, etc.) to pass through
    const connectorConfig: ConnectorConfig = {
      ...profile,
      maxRows: config.get<number>('maxRowsToDisplay', 500),
      // Default sslVerify to true if undefined, but respect profile setting
      sslVerify: profile.sslVerify !== undefined ? profile.sslVerify : true,
    };

    // Validation (Connector Self-Validation)
    const connector = this.getConnector(profile.type);
    const validationError = connector.validateConfig(connectorConfig);
    if (validationError) {
      this.logger.error(
        `Configuration validation failed`,
        { error: validationError },
        correlationId
      );
      throw new Error(`Configuration Error: ${validationError}`);
    }

    let authHeader: string | undefined;
    if (profile.password) {
      authHeader = 'Basic ' + Buffer.from(`${profile.user}:${profile.password}`).toString('base64');
    }

    try {
      yield* connector.runQuery(query, connectorConfig, authHeader, abortSignal);
      this.logger.info(`Query execution completed`, undefined, correlationId);
    } catch (e: unknown) {
      this.logger.error(`Query execution failed`, e, correlationId);
      throw e;
    }
  }

  /**
   * Tests connectivity by running a lightweight query (SELECT 1).
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
