import {
  IConnector,
  ConnectorConfig,
  QueryPage,
  ColumnDef,
  ConnectionError,
  QueryError,
  AuthenticationError,
} from '@sql-preview/connector-api';
import type { Client, ClientConfig, QueryResult } from 'pg';

// We must manually define PostgresConnectionProfile here since it's used internally
// but the shared api only exports BaseConnectionProfile
export interface PostgresConnectionProfile extends ConnectorConfig {
  type: 'postgres';
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  ssl: boolean;
  sslVerify?: boolean;
}

export default class PostgreSQLConnector implements IConnector<ConnectorConfig> {
  readonly id = 'postgres';
  readonly supportsPagination = false; // Postgres returns all results at once (currently)

  readonly configSchema = {
    type: 'object',
    properties: {
      host: {
        type: 'string',
        title: 'Host',
        description: 'Database server hostname or IP',
        default: 'localhost',
      },
      port: { type: 'number', title: 'Port', description: 'Database server port', default: 5432 },
      user: { type: 'string', title: 'User', description: 'Database username' },
      password: {
        type: 'string',
        title: 'Password',
        description: 'Database password (stored securely)',
        ui: { widget: 'password' },
      },
      database: { type: 'string', title: 'Database', description: 'Database name' },
      ssl: { type: 'boolean', title: 'Use SSL', default: false },
    },
    required: ['host', 'port', 'user', 'database'],
  };

  constructor(private readonly driverManager: any) {}

  validateConfig(config: ConnectorConfig): string | undefined {
    const pgConfig = config as unknown as PostgresConnectionProfile;
    if (!pgConfig.host) {
      return 'Host is required';
    }
    if (!pgConfig.port) {
      return 'Port is required';
    }
    if (!pgConfig.user) {
      return 'User is required';
    }
    if (!pgConfig.database) {
      return 'Database is required';
    }
    return undefined;
  }

  async *runQuery(
    query: string,
    config: ConnectorConfig,
    _authHeader?: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown> {
    const pgConfig = config as unknown as PostgresConnectionProfile;
    const driverPath = await this.driverManager.getDriver('pg');

    // Dynamically require pg
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pg = require(driverPath);
    const { Client } = pg;

    const clientConfig: ClientConfig = {
      host: pgConfig.host,
      port: pgConfig.port,
      user: pgConfig.user,
      password: pgConfig.password,
      database: pgConfig.database,
      ssl: pgConfig.ssl
        ? {
            rejectUnauthorized: pgConfig.sslVerify ?? true,
          }
        : false,
      connectionTimeoutMillis: 10000, // 10s connection timeout
    };

    const client: Client = new Client(clientConfig);

    try {
      await client.connect();

      if (abortSignal?.aborted) {
        return;
      }

      // For this initial version, we buffer results.
      // Future improvement: use pg-cursor or pg-query-stream for proper streaming.
      const result: QueryResult = await client.query(query);

      if (result.rows.length > 0) {
        const columns: ColumnDef[] = result.fields.map(f => ({
          name: f.name,
          type: this.mapPostgresType(f.dataTypeID),
        }));

        // Convert rows to arrays
        const data = result.rows.map(row => {
          return columns.map(col => row[col.name]);
        });

        yield {
          columns,
          data,
          stats: {
            state: 'FINISHED',
            rowCount: result.rowCount ?? 0,
          },
        };
      } else {
        // Yield structure even if empty
        yield {
          columns: result.fields.map(f => ({
            name: f.name,
            type: this.mapPostgresType(f.dataTypeID),
          })),
          data: [],
          stats: {
            state: 'FINISHED',
            rowCount: 0,
          },
        };
      }
    } catch (error: unknown) {
      if (abortSignal?.aborted) {
        return;
      }
      this.handleError(error, query);
    } finally {
      await client.end().catch(() => {
        /* ignore close errors */
      });
    }
  }

  private mapPostgresType(oid: number): string {
    // Basic mapping based on OID (Object Identifier)
    // This is optional but helps with UI display
    // See: https://github.com/postgres/postgres/blob/master/src/include/catalog/pg_type.dat
    switch (oid) {
      case 20: // int8
      case 21: // int2
      case 23: // int4
        return 'integer';
      case 700: // float4
      case 701: // float8
      case 1700: // numeric
        return 'number';
      case 16: // bool
        return 'boolean';
      case 1114: // timestamp
      case 1184: // timestamptz
        return 'timestamp';
      case 1082: // date
        return 'date';
      default:
        return 'string';
    }
  }

  private handleError(error: unknown, query: string): never {
    const err = error as Error & { code?: string };
    const msg = err.message || String(error);

    // PG error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
    if (err.code) {
      if (err.code.startsWith('28')) {
        // Class 28 — Invalid Authorization Specification
        throw new AuthenticationError(`Authentication failed: ${msg}`);
      }
      if (err.code.startsWith('08')) {
        // Class 08 — Connection Exception
        throw new ConnectionError(`Connection failed: ${msg}`);
      }
    }

    // Fallback based on message
    if (msg.includes('password') || msg.includes('authentication')) {
      throw new AuthenticationError(msg);
    }
    if (msg.includes('ECONNREFUSED') || msg.includes('does not exist')) {
      throw new ConnectionError(msg);
    }

    throw new QueryError(`Query failed: ${msg}`, query);
  }
}
