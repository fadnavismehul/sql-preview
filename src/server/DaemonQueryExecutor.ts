import { IConnector, ConnectorConfig } from '../connectors/base/IConnector';
import { ConnectorRegistry } from '../connectors/base/ConnectorRegistry';
import { QueryPage, ConnectionProfile } from '../common/types';
import type { DuckDbConnectionProfile } from '@sql-preview/connector-api';
import { ConnectionManager } from './connection/ConnectionManager';
import { ILogger } from '../common/logger';

import { isFileQuery } from '../common/routing';
import { DriverManager } from '../services/DriverManager';

import { SubProcessConnectorClient } from '../connectors/base/SubProcessConnectorClient';

export class DaemonQueryExecutor {
  constructor(
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly connectionManager: ConnectionManager,
    private readonly logger: ILogger,
    private readonly driverManager: DriverManager
  ) {}

  private async getConnectorForProfile(profile: ConnectionProfile): Promise<IConnector> {
    // If it's a built-in profile type but we want to run it out-of-process
    // or if it's explicitly a 'custom' type.

    let executablePath: string;
    let connectorId = profile.type as string;

    if (profile.type === 'custom') {
      const customProfile = profile as ConnectionProfile & {
        connectorPath?: string;
        name?: string;
      };
      connectorId = `custom-${customProfile.name}`;
      try {
        executablePath = await this.driverManager.getConnectorExecutablePath(
          'custom',
          customProfile.connectorPath
        );
      } catch (e) {
        throw new Error(
          `Failed to locate custom connector: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    } else {
      // Attempt to run built-in connectors as sub-processes (RFC-013)
      try {
        executablePath = await this.driverManager.getConnectorExecutablePath(profile.type);
      } catch (e) {
        this.logger.warn(
          `Could not find external executable for ${profile.type}, falling back to in-process registry`
        );
        const connector = this.connectorRegistry.get(profile.type);
        if (!connector) {
          throw new Error(
            `Connector '${profile.type}' not registered natively and executable not found.`
          );
        }
        return connector;
      }
    }

    this.logger.info(
      `Spawning out-of-process connector client for [${connectorId}] at ${executablePath}`
    );
    return new SubProcessConnectorClient(connectorId, executablePath);
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
            const tempProfile: DuckDbConnectionProfile = {
              id: 'adhoc-duckdb',
              name: 'Adhoc DuckDB',
              type: 'duckdb',
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
              type: 'duckdb',
              databasePath: ':memory:', // Default to memory, CWD set by process
              sslVerify: true,
            } as DuckDbConnectionProfile;
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
    const maxRows = process.env['SQL_PREVIEW_MAX_ROWS']
      ? parseInt(process.env['SQL_PREVIEW_MAX_ROWS'], 10)
      : 10000;
    const connectorConfig: ConnectorConfig = {
      ...profile,
      maxRows,
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
      const tempProfile = {
        ...config,
        type: type as ConnectionProfile['type'],
        id: 'test',
      } as unknown as ConnectionProfile;
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
