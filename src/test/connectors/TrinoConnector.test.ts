import axios from 'axios';
import { TrinoConnector, TrinoConfig } from '../../connectors/trino/TrinoConnector';

jest.mock('axios');
const mockedAxios = axios as unknown as jest.Mocked<typeof axios>;

describe('TrinoConnector', () => {
  let connector: TrinoConnector;
  const config: TrinoConfig = {
    host: 'localhost',
    port: 8080,
    user: 'test',
    ssl: false,
  };

  beforeEach(() => {
    connector = new TrinoConnector();
    jest.clearAllMocks();
  });

  it('should handle connection error in pagination loop', async () => {
    // First request succeeds (Coordinator)
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        id: 'query_id',
        nextUri: 'http://worker-node:8080/v1/statement/executing/1',
        stats: { state: 'QUEUED' },
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    } as any);

    // Second request fails (Worker unreachable)
    const networkError = new Error('connect ECONNREFUSED 1.2.3.4:8080');
    (networkError as any).code = 'ECONNREFUSED';
    (networkError as any).config = { url: 'http://worker-node:8080/v1/statement/executing/1' };

    // Mock isAxiosError implementation
    (mockedAxios as any).isAxiosError = (payload: any) => payload === networkError;
    (mockedAxios as any).isCancel = jest.fn().mockReturnValue(false);

    mockedAxios.get.mockRejectedValueOnce(networkError);

    const iterator = connector.runQuery('SELECT * FROM table', config);

    // First yield (from post)
    await iterator.next();

    // Second yield (should fail with URL in message)
    await expect(iterator.next()).rejects.toThrow(
      'Connection failed: connect ECONNREFUSED 1.2.3.4:8080 (http://worker-node:8080/v1/statement/executing/1)'
    );
  });
});
