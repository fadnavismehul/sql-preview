import { QueryPage } from '../../common/types';

/**
 * Generic configuration object for any connector.
 * Connectors are responsible for validating their own config.
 */
export type ConnectorConfig = Record<string, unknown>;

export interface IConnector<TConfig = ConnectorConfig> {
  /**
   * Unique ID of the connector type (e.g. 'trino', 'postgres')
   */
  readonly id: string;

  /**
   * Validates if the configuration has necessary fields.
   * Returns an error message if invalid, or undefined if valid.
   */
  validateConfig(config: TConfig): string | undefined;

  /**
   * Executes a query against the data source.
   */
  /**
   * Executes a query against the data source.
   */
  runQuery(
    query: string,
    config: TConfig,
    authHeader?: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown>;

  /**
   * Optional method to test connection and validate configuration (e.g. catalog/schema existence).
   * If not implemented, the executor may fall back to running a simple query like SELECT 1.
   */
  testConnection?(
    config: TConfig,
    authHeader?: string
  ): Promise<{ success: boolean; error?: string }>;
}
