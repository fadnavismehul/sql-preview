// Core Types
export interface ColumnDef {
  name: string;
  type: string;
}

export interface QueryPage {
  columns?: ColumnDef[] | undefined;
  data: unknown[][];
  nextUri?: string | undefined;
  infoUri?: string | undefined;
  id?: string | undefined;
  remoteTabId?: string | undefined; // To link local tab to remote daemon tab
  stats?:
  | {
    state: string;
    [key: string]: unknown;
  }
  | undefined;
  supportsPagination?: boolean | undefined;
}

// Connection Profile Types
export type ConnectorType = 'trino' | 'postgres' | 'sqlite' | 'custom' | 'duckdb' | 'mysql' | 'mssql' | 'snowflake';

export interface BaseConnectionProfile {
  id: string;
  name: string;
  type: ConnectorType;
  host: string;
  port: number;
  user: string;
  password?: string;
  ssl: boolean;
  sslVerify?: boolean;
  driverPath?: string;
}

export interface TrinoConnectionProfile extends BaseConnectionProfile {
  type: 'trino';
  catalog?: string;
  schema?: string;
  customAuthHeader?: string;
}

export interface PostgresConnectionProfile extends BaseConnectionProfile {
  type: 'postgres';
  database: string;
}

export interface SQLiteConnectionProfile {
  id: string;
  name: string;
  type: 'sqlite';
  databasePath: string;
  password?: string;
  driverPath?: string;
}

export interface DuckDbConnectionProfile {
  id: string;
  name: string;
  type: 'duckdb';
  databasePath: string;
  password?: string;
  driverPath?: string;
  sslVerify?: boolean;
}

export interface CustomConnectionProfile extends BaseConnectionProfile {
  type: 'custom';
  connectorPath: string;
  config: Record<string, unknown>;
}

export interface MySQLConnectionProfile extends BaseConnectionProfile {
  type: 'mysql';
  database: string;
  timezone?: string;
  connectTimeout?: number;
  trustServerCertificate?: boolean;
}

export interface MSSQLConnectionProfile extends BaseConnectionProfile {
  type: 'mssql';
  database: string;
  instance?: string;           // named instance, e.g. SQLEXPRESS
  trustServerCertificate?: boolean; // true for local/dev self-signed certs
  connectionTimeout?: number;  // ms, default 15000
  requestTimeout?: number;     // ms, default 30000
  domain?: string;             // NTLM domain (optional)
}

export interface SnowflakeConnectionProfile {
  id: string;
  name: string;
  type: 'snowflake';
  account: string;              // e.g. "myorg-myaccount"
  username: string;
  password?: string;
  privateKeyPath?: string;      // absolute path to PEM private key
  privateKeyPassphrase?: string;
  warehouse?: string;
  database?: string;
  schema?: string;
  role?: string;
  loginTimeout?: number;        // seconds, default: 60
  application?: string;         // reported to Snowflake, default: "sql-preview"
  driverPath?: string;
}

export type ConnectionProfile =
  | TrinoConnectionProfile
  | PostgresConnectionProfile
  | SQLiteConnectionProfile
  | DuckDbConnectionProfile
  | CustomConnectionProfile
  | MySQLConnectionProfile
  | MSSQLConnectionProfile
  | SnowflakeConnectionProfile;

// Legacy Configuration for backward compatibility (maps to Trino)
export interface ConnectorConfig {
  host?: string;
  port?: number;
  user?: string;
  catalog?: string;
  schema?: string;
  ssl?: boolean;
  sslVerify?: boolean;
  maxRows?: number;
  password?: string;
  connectionId?: string;
  [key: string]: any; // Allow for custom plugin properties
}

export interface IConnector<TConfig extends ConnectorConfig = ConnectorConfig> {
  readonly id: string;
  readonly supportsPagination: boolean;

  validateConfig(config: TConfig): string | undefined;

  runQuery(
    query: string,
    config: TConfig,
    authHeader?: string,
    cancelToken?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown>;

  testConnection?(
    config: TConfig,
    authHeader?: string
  ): Promise<{ success: boolean; error?: string }>;
}

// Custom Error classes
export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AuthenticationError extends ConnectorError {
  constructor(message: string, details?: string) {
    super(message, details);
  }
}

export class ConnectionError extends ConnectorError {
  constructor(message: string, details?: string) {
    super(message, details);
  }
}

export class QueryError extends ConnectorError {
  constructor(
    message: string,
    public readonly query?: string,
    details?: string
  ) {
    super(message, details);
  }
}
