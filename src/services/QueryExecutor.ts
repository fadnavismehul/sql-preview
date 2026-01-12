import * as vscode from 'vscode';
import { AuthManager } from './AuthManager';
import { IConnector, ConnectorConfig } from './connectors/IConnector';
import { TrinoConnector } from './connectors/TrinoConnector';
import { QueryPage } from '../common/types';

export class QueryExecutor {
  private connector: IConnector;

  constructor(private readonly authManager: AuthManager) {
    // Factory logic could go here, for now default to Trino
    this.connector = new TrinoConnector();
  }

  /**
   * Orchestrates the query execution:
   * 1. Reads configuration
   * 2. Gets credentials
   * 3. Delegates to connector
   */
  async *execute(query: string): AsyncGenerator<QueryPage, void, unknown> {
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

    // Removed useless try/catch
    yield* this.connector.runQuery(query, connectorConfig, authHeader);
  }
}
