import axios from 'axios';
import * as https from 'https';
import { IConnector, ConnectorConfig } from './IConnector';
import { QueryPage } from '../../common/types';
import { safeJsonParse } from '../../utils/jsonUtils';

interface TrinoResponse {
  id?: string;
  infoUri?: string;
  nextUri?: string;
  columns?: Array<{ name: string; type: string }>;
  data?: unknown[][];
  error?: any;
  stats?: {
    state: string;
    [key: string]: any;
  };
}

export class TrinoConnector implements IConnector {
  async *runQuery(
    query: string,
    config: ConnectorConfig,
    authHeader?: string
  ): AsyncGenerator<QueryPage, void, unknown> {
    const protocol = config.ssl ? 'https' : 'http';
    const baseUrl = `${protocol}://${config.host}:${config.port}`;
    const statementUrl = `${baseUrl}/v1/statement`;

    const httpsAgent = config.ssl
      ? new https.Agent({ rejectUnauthorized: config.sslVerify })
      : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
      'X-Trino-User': config.user,
      'X-Trino-Source': 'sql-preview',
      ...(config.catalog ? { 'X-Trino-Catalog': config.catalog } : {}),
      ...(config.schema ? { 'X-Trino-Schema': config.schema } : {}),
      // Compatibility headers
      'X-Presto-User': config.user,
      'X-Presto-Source': 'sql-preview',
      ...(config.catalog ? { 'X-Presto-Catalog': config.catalog } : {}),
      ...(config.schema ? { 'X-Presto-Schema': config.schema } : {}),
    };

    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    // Configure axios safely
    const axiosConfig = {
      headers,
      httpsAgent,
      transformResponse: [(data: any) => safeJsonParse(data)],
    };

    // Initial POST
    let nextUri: string | undefined;
    try {
      // Cast config to any to avoid strict Axios typing issues with custom transform response
      const response = await axios.post<TrinoResponse>(statementUrl, query, axiosConfig as any);
      const result = response.data;

      if (result.error) {
        throw new Error(result.error.message || 'Trino query error');
      }

      nextUri = result.nextUri;

      // Yield first page if it has data or just basic info
      yield {
        columns: result.columns || undefined,
        data: result.data || [],
        nextUri: result.nextUri || undefined,
        infoUri: result.infoUri || undefined,
        id: result.id || undefined,
        stats: result.stats || undefined,
      };
    } catch (error: any) {
      // Enhance error message
      const msg = error.response?.data?.error?.message || error.message;
      throw new Error(`Query failed: ${msg}`);
    }

    // Pagination loop
    while (nextUri) {
      try {
        const response = await axios.get<TrinoResponse>(nextUri, axiosConfig as any);
        const result = response.data;

        if (result.error) {
          throw new Error(result.error.message || 'Trino pagination error');
        }

        nextUri = result.nextUri;

        // Trino often returns pages with no data (just stats updates), skip yielding empty data pages unless they are the final one
        if ((result.data && result.data.length > 0) || !nextUri) {
          yield {
            columns: result.columns || undefined,
            data: result.data || [],
            nextUri: result.nextUri || undefined,
            id: result.id || undefined,
            stats: result.stats || undefined,
          };
        }
      } catch (error: any) {
        const msg = error.response?.data?.error?.message || error.message;
        throw new Error(`Pagination failed: ${msg}`);
      }
    }
  }
}
