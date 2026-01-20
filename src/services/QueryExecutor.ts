import * as vscode from 'vscode';

import { IConnector, ConnectorConfig } from './connectors/IConnector';
import { ConnectorRegistry } from './connectors/ConnectorRegistry';
import { QueryPage } from '../common/types';

import { ConnectionManager } from './ConnectionManager';
import { TrinoConnectionProfile } from '../common/types';

export class QueryExecutor {
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
   * Orchestrates the query execution:
   * 1. Reads configuration from ConnectionManager
   * 2. Gets credentials from ConnectionManager
   * 3. Delegates to connector
   */
  async *execute(
    query: string,
    contextUri?: vscode.Uri,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown> {
    // Resolve Connection Profile
    const connections = await this.connectionManager.getConnections();
    if (connections.length === 0) {
      throw new Error(
        "No connection profile found. Please add a connection in SQL Preview 'Connections' menu."
      );
    }

    // Use the first connection for now (Active Profile selection to be added)
    const profile = await this.connectionManager.getConnection(connections[0]!.id);
    if (!profile) {
      throw new Error('Failed to load connection profile.');
    }

    const config = vscode.workspace.getConfiguration('sqlPreview', contextUri);
    const trinoProfile = profile as TrinoConnectionProfile;

    const connectorConfig: ConnectorConfig = {
      host: profile.host,
      port: profile.port,
      user: profile.user,
      ssl: profile.ssl,
      sslVerify: profile.sslVerify !== undefined ? profile.sslVerify : true,
      maxRows: config.get<number>('maxRowsToDisplay', 500),
      ...(trinoProfile.catalog ? { catalog: trinoProfile.catalog } : {}),
      ...(trinoProfile.schema ? { schema: trinoProfile.schema } : {}),
    };

    let authHeader: string | undefined;
    if (profile.password) {
      authHeader = 'Basic ' + Buffer.from(`${profile.user}:${profile.password}`).toString('base64');
    }

    // Get connector instance
    const connector = this.getConnector(profile.type);
    yield* connector.runQuery(query, connectorConfig, authHeader, abortSignal);
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
      const iterator = connector.runQuery('SELECT 1', config, authHeader);
      // Attempt to fetch first page to validate connection & auth
      await iterator.next();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }
}
