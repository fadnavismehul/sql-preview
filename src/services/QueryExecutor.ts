import * as vscode from 'vscode';
import { AuthManager } from './AuthManager';
import { IConnector, ConnectorConfig } from './connectors/IConnector';
import { ConnectorRegistry } from './connectors/ConnectorRegistry';
import { QueryPage } from '../common/types';

export class QueryExecutor {
  constructor(
    private readonly authManager: AuthManager,
    private readonly connectorRegistry: ConnectorRegistry
  ) {}

  private getConnector(): IConnector {
    const config = vscode.workspace.getConfiguration('sqlPreview');
    const connectorName = config.get<string>('defaultConnector', 'trino');

    const connector = this.connectorRegistry.get(connectorName);
    if (!connector) {
      throw new Error(`Connector '${connectorName}' not registered`);
    }
    return connector;
  }

  /**
   * Orchestrates the query execution:
   * 1. Reads configuration
   * 2. Gets credentials
   * 3. Delegates to connector
   */
  async *execute(
    query: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown> {
    const config = vscode.workspace.getConfiguration('sqlPreview');

    // Explicitly handle potentially undefined values
    const catalog = config.get<string>('catalog');
    const schema = config.get<string>('schema');

    const connectorConfig: ConnectorConfig = {
      host: config.get<string>('host', 'localhost'),
      port: config.get<number>('port', 8080),
      user: config.get<string>('user', 'user'),
      catalog: catalog || undefined, // Ensure undefined if empty/null
      schema: schema || undefined, // Ensure undefined if empty/null
      ssl: config.get<boolean>('ssl', false),
      sslVerify: config.get<boolean>('sslVerify', true),
      maxRows: config.get<number>('maxRowsToDisplay', 500),
    };

    const authHeader = await this.authManager.getBasicAuthHeader(connectorConfig.user);

    // Get connector instance
    const connector = this.getConnector();
    yield* connector.runQuery(query, connectorConfig, authHeader, abortSignal);
  }
}
