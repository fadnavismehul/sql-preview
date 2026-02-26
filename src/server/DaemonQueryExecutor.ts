import { IConnector, ConnectorConfig } from '../connectors/base/IConnector';
import { ConnectorRegistry } from '../connectors/base/ConnectorRegistry';
import { QueryPage, ConnectionProfile } from '../common/types';
import { ConnectionManager } from './connection/ConnectionManager';
import { ILogger } from '../common/logger';

import { isFileQuery } from '../common/routing';
import { DriverManager } from '../services/DriverManager';

export class DaemonQueryExecutor {
  constructor(
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly connectionManager: ConnectionManager,
    private readonly logger: ILogger,
    private readonly driverManager: DriverManager
  ) { }

  private async getConnectorForProfile(profile: ConnectionProfile): Promise<IConnector> {
    if (profile.type === 'custom') {
      const pkgName = profile.connectorPackage;

      try {
        this.logger.info(`Loading custom connector from package: ${pkgName}`);
        const driverPath = await this.driverManager.getDriver(pkgName);

        let ImportedModule;
        // Use require or dynamic import based on module type. 
        // We'll try dynamic import first.
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          ImportedModule = require(driverPath);
        } catch (e) {
          ImportedModule = await import(driverPath);
        }

        const ConnectorClass = ImportedModule.default || ImportedModule.Connector || ImportedModule;

        if (typeof ConnectorClass !== 'function') {
          throw new Error(`Custom connector package '${pkgName}' does not export a constructor. It must export a default class or a 'Connector' class.`);
        }

        // Try to pass driver manager just in case, but custom connectors might not expect it
        // We follow standard JS constructor patterns
        const connector = new ConnectorClass(this.driverManager) as IConnector;

        if (!connector.id || !connector.runQuery) {
          throw new Error(`Custom connector '${pkgName}' does not properly implement the IConnector interface.`);
        }

        return connector;
      } catch (e) {
        this.logger.error(`Failed to load custom connector [${pkgName}]`, e);
        throw new Error(`Failed to initialize custom connector '${pkgName}': ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const connector = this.connectorRegistry.get(profile.type);
    if (!connector) {
      throw new Error(`Connector '${profile.type}' not registered`);
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
    } else {
      // 1. Smart Routing Strategy
      // We check this BEFORE connectionId to allow "adhoc" file queries (e.g. FROM 'data.csv')
      // to override the currently selected connection in the UI.
      if (isFileQuery(query)) {
        const isSqliteFile = /[^']+\.(sqlite|db)\s*'/i.test(query);

        if (isSqliteFile) {
          try {
            const tempProfile: ConnectionProfile = {
              id: 'adhoc-sqlite',
              name: 'Adhoc SQLite',
              type: 'sqlite',
              databasePath: '', // Will update
            };
            await this.getConnectorForProfile(tempProfile);
            this.logger.info(
              'Detected local sqlite file query pattern, switching to Adhoc SQLite profile'
            );
            // Extract the path for the Adhoc profile from the query.
            // In a real file query "SELECT * FROM 'path.db'", it's in the FROM clause.
            const pathMatch = query.match(
              /from(?:\s+|(?:\s*--[^\n]*\n)|(?:\s*\/\*[\s\S]*?\*\/))*'([^']+)'/i
            );
            const databasePath = pathMatch && pathMatch[1] ? pathMatch[1].trim() : '';

            profile = {
              id: 'adhoc-sqlite',
              name: 'Adhoc SQLite',
              type: 'sqlite',
              databasePath: databasePath,
            };
          } catch (e) {
            this.logger.error('SQLite connector failed during auto-routing', e);
            throw new Error(
              `Auto-Routing Failed: Detected file query but SQLite connector is unavailable. ${e instanceof Error ? e.message : String(e)}`
            );
          }
        } else {
          try {
            // Check availability
            const tempProfile: ConnectionProfile = {
              id: 'adhoc-duckdb',
              name: 'Adhoc DuckDB',
              type: 'duckdb' as any,
              databasePath: ':memory:',
              sslVerify: true,
            };
            await this.getConnectorForProfile(tempProfile);
            this.logger.info(
              'Detected local file query pattern, switching to Adhoc DuckDB profile'
            );
            profile = {
              id: 'adhoc-duckdb',
              name: 'Adhoc DuckDB',
              type: 'duckdb' as any,
              databasePath: ':memory:', // Default to memory, CWD set by process
              sslVerify: true,
            };
          } catch (e) {
            this.logger.error('DuckDB connector failed during auto-routing', e);
            throw new Error(
              `Auto-Routing Failed: Detected file query but DuckDB connector is unavailable. ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }
      }

      // 2. If Smart Routing didn't pick a profile, use connectionId if provided
      if (!profile && connectionId) {
        profile = await this.connectionManager.getProfile(connectionId);
      }

      // 3. Fallback to first available connection if still no profile
      if (!profile) {
        this.logger.info(`Fetching connections for fallback...`);
        const connections = await this.connectionManager.getProfiles();
        this.logger.info(`Found ${connections.length} connections.`);
        if (connections.length > 0 && connections[0]) {
          // Need to fetch full profile including password
          profile = await this.connectionManager.getProfile(connections[0].id);
        }
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
    const connector = await this.getConnectorForProfile(profile);
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
      // In testConnection, config is a ConnectorConfig, which contains type but may lack full profile structure.
      // Let's create a temporary profile for loading.
      const tempProfile = { ...config, type: type as any, id: 'test' } as unknown as ConnectionProfile;
      const connector = await this.getConnectorForProfile(tempProfile);
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
