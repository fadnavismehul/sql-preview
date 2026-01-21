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
  runQuery(
    query: string,
    config: TConfig,
    authHeader?: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown>;
}
