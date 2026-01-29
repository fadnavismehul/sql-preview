import axios from 'axios';
import { TrinoConnector, TrinoConfig } from '../../connectors/trino/TrinoConnector';

jest.mock('axios');
const mockedAxios = axios as unknown as jest.Mocked<typeof axios>;

describe('TrinoConnector Validation', () => {
  let connector: TrinoConnector;
  const config: TrinoConfig = {
    host: 'localhost',
    port: 8080,
    user: 'test',
    catalog: 'my_catalog',
    schema: 'my_schema',
    ssl: false,
  };

  beforeEach(() => {
    connector = new TrinoConnector();
    jest.clearAllMocks();
    // Default mock implementation to avoid errors on unmocked calls
    (mockedAxios as any).isCancel = jest.fn().mockReturnValue(false);
    (mockedAxios as any).isAxiosError = (payload: any) => !!payload.isAxiosError;
  });

  const mockTrinoResponse = (data: any[][], nextUri?: string) => {
    return {
      data: {
        id: 'query_id',
        nextUri,
        columns: [{ name: 'col', type: 'varchar' }],
        data,
        stats: { state: 'FINISHED' },
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
      request: {},
    } as any;
  };

  it('should pass validation when catalog and schema exist', async () => {
    // 1. SELECT 1
    mockedAxios.post.mockResolvedValueOnce(mockTrinoResponse([[1]]));

    // 2. SHOW CATALOGS -> contains 'my_catalog'
    mockedAxios.post.mockResolvedValueOnce(mockTrinoResponse([['other'], ['my_catalog']]));

    // 3. SHOW SCHEMAS -> contains 'my_schema'
    mockedAxios.post.mockResolvedValueOnce(
      mockTrinoResponse([['information_schema'], ['my_schema']])
    );

    const result = await connector.testConnection(config);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should fail when catalog does not exist', async () => {
    // 1. SELECT 1
    mockedAxios.post.mockResolvedValueOnce(mockTrinoResponse([[1]]));

    // 2. SHOW CATALOGS -> does NOT contain 'my_catalog'
    mockedAxios.post.mockResolvedValueOnce(mockTrinoResponse([['other'], ['system']]));

    const result = await connector.testConnection(config);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Catalog 'my_catalog' does not exist");
  });

  it('should fail when schema does not exist', async () => {
    // 1. SELECT 1
    mockedAxios.post.mockResolvedValueOnce(mockTrinoResponse([[1]]));

    // 2. SHOW CATALOGS -> contains 'my_catalog'
    mockedAxios.post.mockResolvedValueOnce(mockTrinoResponse([['my_catalog']]));

    // 3. SHOW SCHEMAS -> does NOT contain 'my_schema'
    mockedAxios.post.mockResolvedValueOnce(mockTrinoResponse([['other_schema']]));

    const result = await connector.testConnection(config);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Schema 'my_schema' does not exist");
  });

  it('should return check success if catalog/schema not configured', async () => {
    const minimalConfig: TrinoConfig = {
      host: 'localhost',
      port: 8080,
      user: 'test',
      ssl: false,
    };
    // 1. SELECT 1
    mockedAxios.post.mockResolvedValueOnce(mockTrinoResponse([[1]]));

    const result = await connector.testConnection(minimalConfig);
    expect(result.success).toBe(true);
  });
});
