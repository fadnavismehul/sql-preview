import { SubProcessConnectorClient } from '../../../../connectors/base/SubProcessConnectorClient';
import { ConnectorConfig } from '@sql-preview/connector-api';

jest.mock('child_process');

describe('SubProcessConnectorClient', () => {
  let client: SubProcessConnectorClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SubProcessConnectorClient('test-id', '/mock/path/cli.js');
  });

  it('should validate initialization properly', () => {
    const config: ConnectorConfig = { id: 'test', name: 'Test', type: 'custom' as any };
    expect(() => {
      client.validateConfig(config);
    }).not.toThrow();
  });
});
