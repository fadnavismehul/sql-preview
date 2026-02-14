import { QueryExecutor } from '../core/execution/QueryExecutor';
import { ResultsViewProvider } from '../ui/webviews/results/ResultsViewProvider';
import { TabManager } from './TabManager';
import { ExportService } from './ExportService';
import { ConnectorRegistry } from '../connectors/base/ConnectorRegistry';
import { TrinoConnector } from '../connectors/trino/TrinoConnector';

import { PostgreSQLConnector } from '../connectors/postgres/PostgreSQLConnector';
import { QuerySessionRegistry } from './QuerySessionRegistry';
import { Logger } from '../core/logging/Logger';
import { LogLevel } from '../common/types';
import * as vscode from 'vscode';

import { ConnectionManager } from './ConnectionManager';
import { DriverManager } from './DriverManager';

import { DaemonClient } from './DaemonClient';

export class ServiceContainer {
  private static instance: ServiceContainer;

  public readonly connectionManager: ConnectionManager;
  public readonly driverManager: DriverManager;
  public readonly connectorRegistry: ConnectorRegistry;
  public readonly queryExecutor: QueryExecutor;
  public readonly tabManager: TabManager;
  public readonly exportService: ExportService;
  public readonly querySessionRegistry: QuerySessionRegistry;
  public readonly resultsViewProvider: ResultsViewProvider;
  public readonly daemonClient: DaemonClient;

  private constructor(context: vscode.ExtensionContext) {
    this.connectionManager = new ConnectionManager(context);
    this.driverManager = new DriverManager(context);

    // Initialize Registry and Connectors
    this.connectorRegistry = new ConnectorRegistry();
    this.connectorRegistry.register(new TrinoConnector());

    this.connectorRegistry.register(new PostgreSQLConnector(this.driverManager));

    this.daemonClient = new DaemonClient(context);

    // Pass DaemonClient to QueryExecutor
    this.queryExecutor = new QueryExecutor(
      this.connectorRegistry,
      this.connectionManager,
      this.daemonClient,
      this.driverManager
    );
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
      this.queryExecutor,
      this.daemonClient
    );

    // Wire up Daemon Notifications
    this.daemonClient.onRefresh = () => {
      this.syncRemoteSessions();
    };
  }

  public static initialize(context: vscode.ExtensionContext): ServiceContainer {
    if (!ServiceContainer.instance) {
      // Initialize logging early
      const config = vscode.workspace.getConfiguration('sqlPreview');
      let logLevelStr = config.get<string>('logLevel', 'INFO');

      // Allow env var to override (for debug mode)
      if (process.env['SQL_PREVIEW_LOG_LEVEL']) {
        logLevelStr = process.env['SQL_PREVIEW_LOG_LEVEL'];
      }

      const logLevel = (LogLevel as any)[logLevelStr] || LogLevel.INFO;

      Logger.initialize({
        outputChannelName: 'SQL Preview',
        logLevel: logLevel,
      });
      ServiceContainer.instance = new ServiceContainer(context);
      // Ensure daemon is started?
      ServiceContainer.instance.daemonClient.start().catch(err => {
        Logger.getInstance().error('Failed to start daemon', err);
      });
    }
    return ServiceContainer.instance;
  }

  public static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      throw new Error('ServiceContainer not initialized. Call initialize(context) first.');
    }
    return ServiceContainer.instance;
  }

  private async syncRemoteSessions() {
    try {
      const sessions = await this.daemonClient.listSessions();
      const currentSessionId = this.daemonClient.getSessionId();
      this.resultsViewProvider.syncRemoteTabs(sessions, currentSessionId);
    } catch (e) {
      Logger.getInstance().error('Failed to sync remote sessions', e);
    }
  }
}
