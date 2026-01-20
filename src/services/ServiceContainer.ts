import { AuthManager } from './AuthManager';
import { QueryExecutor } from './QueryExecutor';
import { ResultsViewProvider } from '../resultsViewProvider';
import { TabManager } from './TabManager';
import { ExportService } from './ExportService';
import { ConnectorRegistry } from './connectors/ConnectorRegistry';
import { TrinoConnector } from './connectors/TrinoConnector';
import { QuerySessionRegistry } from './QuerySessionRegistry';
import * as vscode from 'vscode';

import { ConnectionManager } from './ConnectionManager';

export class ServiceContainer {
  private static instance: ServiceContainer;

  public readonly authManager: AuthManager;
  public readonly connectionManager: ConnectionManager;
  public readonly connectorRegistry: ConnectorRegistry;
  public readonly queryExecutor: QueryExecutor;
  public readonly tabManager: TabManager;
  public readonly exportService: ExportService;
  public readonly querySessionRegistry: QuerySessionRegistry;
  public readonly resultsViewProvider: ResultsViewProvider;

  private constructor(context: vscode.ExtensionContext) {
    this.authManager = new AuthManager(context);
    this.connectionManager = new ConnectionManager(context);

    // Initialize Registry and Connectors
    this.connectorRegistry = new ConnectorRegistry();
    this.connectorRegistry.register('trino', new TrinoConnector());
    // Future: this.connectorRegistry.register('postgres', new PostgresConnector());

    this.queryExecutor = new QueryExecutor(this.connectorRegistry, this.connectionManager);
    this.tabManager = new TabManager();
    this.exportService = new ExportService(this.queryExecutor);

    this.querySessionRegistry = new QuerySessionRegistry();
    this.resultsViewProvider = new ResultsViewProvider(
      context.extensionUri,
      context,
      this.tabManager,
      this.exportService,
      this.querySessionRegistry,
      this.connectionManager,
      this.queryExecutor
    );
  }

  public static initialize(context: vscode.ExtensionContext): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer(context);
    }
    return ServiceContainer.instance;
  }

  public static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      throw new Error('ServiceContainer not initialized. Call initialize(context) first.');
    }
    return ServiceContainer.instance;
  }
}
