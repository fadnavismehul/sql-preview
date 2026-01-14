import { QueryPage, ConnectorConfig as SharedConnectorConfig } from '../../common/types';

// Re-export shared config
export type ConnectorConfig = SharedConnectorConfig;

export interface IConnector {
  runQuery(
    query: string,
    config: ConnectorConfig,
    authHeader?: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown>;
}
