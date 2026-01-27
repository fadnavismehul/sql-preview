import * as assert from 'assert';
import axios from 'axios';
import * as sinon from 'sinon';
import { TrinoConnector } from '../../connectors/trino/TrinoConnector';

describe('TrinoConnector Host Sanitization', () => {
  let connector: TrinoConnector;
  let axiosPostStub: sinon.SinonStub;

  beforeEach(() => {
    connector = new TrinoConnector();
    // Mock axios.post using Sinon
    axiosPostStub = sinon.stub(axios, 'post').resolves({
      data: { id: '1', nextUri: undefined, columns: [], data: [] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as any,
    } as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should strip https:// protocol from host', async () => {
    const config = {
      host: 'https://my-trino.com',
      port: 443,
      user: 'test',
      ssl: true,
      sslVerify: true,
    };

    const iterator = connector.runQuery('SELECT 1', config);
    await iterator.next();

    assert.strictEqual(axiosPostStub.called, true);
    const url = axiosPostStub.firstCall.args[0];
    assert.strictEqual(url, 'https://my-trino.com:443/v1/statement');
  });

  it('should strip http:// protocol from host', async () => {
    const config = {
      host: 'http://my-trino.com',
      port: 8080,
      user: 'test',
      ssl: false,
    };

    const iterator = connector.runQuery('SELECT 1', config);
    await iterator.next();

    const url = axiosPostStub.firstCall.args[0];
    assert.strictEqual(url, 'http://my-trino.com:8080/v1/statement');
  });

  it('should strip port from host if present', async () => {
    const config = {
      host: 'my-trino.com:8080',
      port: 8080,
      user: 'test',
      ssl: false,
    };

    const iterator = connector.runQuery('SELECT 1', config);
    await iterator.next();

    const url = axiosPostStub.firstCall.args[0];
    assert.strictEqual(url, 'http://my-trino.com:8080/v1/statement');
  });
});
