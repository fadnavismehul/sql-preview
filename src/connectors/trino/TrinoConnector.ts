import axios, { AxiosRequestConfig, isCancel, isAxiosError } from 'axios';
import * as https from 'https';
import { IConnector, ConnectorConfig } from '../base/IConnector'; // New path
import { QueryPage } from '../../common/types';
import { safeJsonParse } from '../../utils/jsonUtils'; // Need to check if utils moved
import { ConnectionError, QueryError, AuthenticationError } from '../../common/errors'; // Need to check errors path

interface TrinoResponse {
  id?: string;
  infoUri?: string;
  nextUri?: string;
  columns?: Array<{ name: string; type: string }>;
  data?: unknown[][];
  error?: {
    message?: string;
    [key: string]: unknown;
  };
  stats?: {
    state: string;
    [key: string]: unknown;
  };
}

export interface TrinoConfig extends ConnectorConfig {
  host: string;
  port: number;
  user: string;
  catalog?: string;
  schema?: string;
  ssl?: boolean;
  sslVerify?: boolean;
}

export class TrinoConnector implements IConnector<TrinoConfig> {
  readonly id = 'trino';
  readonly supportsPagination = true; // Trino returns results incrementally via nextUri

  validateConfig(config: TrinoConfig): string | undefined {
    if (!config.host) {
      return 'Host is required';
    }
    if (!config.port) {
      return 'Port is required';
    }
    if (!config.user) {
      return 'User is required';
    }
    return undefined;
  }

  async *runQuery(
    query: string,
    config: TrinoConfig,
    authHeader?: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown> {
    // Sanitize Host: Strip protocol if accidentally entered by user
    let cleanHost = config.host;
    if (cleanHost.startsWith('http://')) {
      cleanHost = cleanHost.substring(7);
    } else if (cleanHost.startsWith('https://')) {
      cleanHost = cleanHost.substring(8);
    }

    // Remove trailing slashes if any
    if (cleanHost.endsWith('/')) {
      cleanHost = cleanHost.slice(0, -1);
    }

    // Sanitize Host: Strip port if accidentally entered by user (e.g. localhost:8080)
    // We already have a separate port config.
    const portMatch = cleanHost.match(/:(\d+)$/);
    if (portMatch) {
      cleanHost = cleanHost.substring(0, portMatch.index);
      // Optional: We could warn or override config.port, but stripping it handles the "double port" error.
    }

    const protocol = config.ssl ? 'https' : 'http';
    const baseUrl = `${protocol}://${cleanHost}:${config.port}`;
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
    const axiosConfig: AxiosRequestConfig = {
      headers,
      httpsAgent,
      transformResponse: [(data: unknown) => safeJsonParse(data as string)],
      ...(abortSignal ? { signal: abortSignal } : {}),
    };

    // Initial POST
    let nextUri: string | undefined;
    try {
      // Cast config to any to avoid strict Axios typing issues with custom transform response
      const response = await axios.post<TrinoResponse>(statementUrl, query, axiosConfig);
      const result = response.data;

      if (result.error) {
        throw new QueryError(
          result.error.message || 'Trino query error',
          query,
          JSON.stringify(result.error)
        );
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
    } catch (error: unknown) {
      if (isCancel(error)) {
        return; // Stopped by user
      }
      this.handleError(error, query);
    }

    // Pagination loop
    while (nextUri) {
      if (abortSignal?.aborted) {
        return;
      }

      try {
        const response = await axios.get<TrinoResponse>(nextUri, axiosConfig);
        const result = response.data;

        if (result.error) {
          throw new QueryError(
            result.error.message || 'Trino pagination error',
            query,
            JSON.stringify(result.error)
          );
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
      } catch (error: unknown) {
        if (isCancel(error)) {
          return;
        }
        this.handleError(error, query);
      }
    }
  }

  private handleError(error: unknown, query: string): never {
    if (error instanceof QueryError) {
      throw error;
    }

    let msg = 'Unknown error';
    let status: number | undefined;
    let code: string | undefined;

    if (isAxiosError(error)) {
      // Try to get message from Trino error response first
      const axiosError = error;
      const trinoError = axiosError.response?.data?.error;
      msg = trinoError?.message || axiosError.message;

      if (axiosError.config?.url) {
        msg += ` (${axiosError.config.url})`;
      }

      status = axiosError.response?.status;
      code = axiosError.code;
    } else if (error instanceof Error) {
      msg = error.message;
    } else {
      msg = String(error);
    }

    if (status === 401 || status === 403) {
      throw new AuthenticationError(`Authentication failed: ${msg}`);
    }

    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      throw new ConnectionError(`Connection failed: ${msg}`, code);
    }

    throw new QueryError(`Query failed: ${msg}`, query);
  }

  async testConnection(
    config: TrinoConfig,
    authHeader?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Basic Connectivity
      const connectivityCheck = this.runQuery('SELECT 1', config, authHeader);
      await connectivityCheck.next(); // Ensure we can get at least one yield

      // 2. Validate Catalog (if configured)
      if (config.catalog) {
        const catalogQuery = `SHOW CATALOGS LIKE '${config.catalog}'`;
        const iterator = this.runQuery(catalogQuery, config, authHeader);
        let found = false;

        for await (const page of iterator) {
          if (page.data) {
            for (const row of page.data) {
              // Row format: [catalog_name]
              if (row[0] === config.catalog) {
                found = true;
                break;
              }
            }
          }
        }

        if (!found) {
          return {
            success: false,
            error: `Catalog '${config.catalog}' does not exist on the server.`,
          };
        }
      }

      // 3. Validate Schema (if configured)
      if (config.schema) {
        // Requires catalog to be present to check schema usually, or use current catalog
        // If catalog is set, we check in that catalog. If used default catalog from config, fine.
        // If config.catalog is missing but schema is set, Trino might use a default user catalog or fail.
        // We'll check "FROM <catalog>" only if catalog is explicit, otherwise just "SHOW SCHEMAS"

        let schemaQuery = `SHOW SCHEMAS`;
        if (config.catalog) {
          schemaQuery += ` FROM "${config.catalog}"`;
        }
        schemaQuery += ` LIKE '${config.schema}'`;

        const iterator = this.runQuery(schemaQuery, config, authHeader);
        let found = false;

        for await (const page of iterator) {
          if (page.data) {
            for (const row of page.data) {
              // Row format: [schema_name]
              if (row[0] === config.schema) {
                found = true;
                break;
              }
            }
          }
        }

        if (!found) {
          return {
            success: false,
            error: `Schema '${config.schema}' does not exist${
              config.catalog ? ` in catalog '${config.catalog}'` : ''
            }.`,
          };
        }
      }

      return { success: true };
    } catch (error: unknown) {
      if (error instanceof ConnectionError || error instanceof AuthenticationError) {
        return { success: false, error: error.message };
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
