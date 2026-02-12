import * as assert from 'assert';
import * as http from 'http';
import * as vscode from 'vscode';

import { Daemon } from '../../server/Daemon';

describe('MCP Integration Test Suite', () => {
  vscode.window.showInformationMessage('Start MCP tests.');
  const DAEMON_PORT = 8414;
  let daemon: Daemon;

  // Start Daemon in-process
  before(async () => {
    daemon = new Daemon();
    // Check if port is in use, if so, we assume it's running from extension activation
    // But to be sure, we can try to start it.
    // Daemon.start() might fail if port is in use.
    // Let's try to connect first.
    try {
      await request('/status');
      console.log('Daemon already running.');
    } catch (e) {
      console.log('Starting in-process Daemon for testing...');
      await daemon.start();
    }
  });

  after(() => {
    if (daemon) {
      daemon.stop();
    }
  });

  // Helper to request URL
  function request(
    path: string,
    method = 'GET',
    body?: any,
    headers: any = {},
    captureSSE = false
  ): Promise<{ statusCode?: number; data: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const options = {
        host: '127.0.0.1', // Force IPv4 to avoid ambiguity/zombies
        port: DAEMON_PORT,
        path: path,
        method: method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      };

      const req = http.request(options, res => {
        // If SSE and NOT capturing, or regular request
        if (!captureSSE && headers['Accept'] === 'text/event-stream' && res.statusCode === 200) {
          resolve({ statusCode: res.statusCode || 0, data: '', headers: res.headers });
          req.destroy(); // Close connection
          return;
        }

        let data = '';
        res.on('data', chunk => {
          data += chunk;
          if (captureSSE && data.includes('event: endpoint')) {
            // If we got the endpoint, we can stop
            resolve({ statusCode: res.statusCode || 0, data, headers: res.headers });
            req.destroy();
          }
        });
        res.on('end', () =>
          resolve({ statusCode: res.statusCode || 0, data, headers: res.headers })
        );
      });

      req.on('error', reject);
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  it('Daemon should be running and return status', async () => {
    // Retry a few times as extension activates
    let attempts = 0;
    while (attempts < 10) {
      try {
        const res = await request('/status');
        if (res.statusCode === 200) {
          const json = JSON.parse(res.data);
          assert.strictEqual(json.status, 'running');
          assert.ok(json.service.includes('sql-preview-daemon'));
          return; // Pass
        }
      } catch (e) {
        // Ignore and retry
      }
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }
    assert.fail('Daemon did not respond with 200 OK after retries');
  }).timeout(15000);

  it('Should support Session A connection', async () => {
    // 1. Initial GET (SSE) for Session A
    // Stateful Transport (Initialized) requires Mcp-Session-Id header
    const res = await request('/mcp?sessionId=sessionA', 'GET', undefined, {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Mcp-Session-Id': 'sessionA',
    });
    if (res.statusCode !== 200) {
      console.log('Session A Connection Failed. Body:', res.data);
    }
    assert.strictEqual(res.statusCode, 200, 'Session A SSE connection failed');
  });

  it('Should support Session B connection simultaneously', async () => {
    // 1. Initial GET (SSE) for Session B
    const res = await request('/mcp?sessionId=sessionB', 'GET', undefined, {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Mcp-Session-Id': 'sessionB',
    });
    if (res.statusCode !== 200) {
      console.log('Session B Connection Failed. Body:', res.data);
    }
    assert.strictEqual(res.statusCode, 200, 'Session B SSE connection failed');

    // Check status to see if two distinct sessions exist
    const statusRes = await request('/status');
    const status = JSON.parse(statusRes.data);
    if (status.mcpSessions !== undefined) {
      assert.ok(status.mcpSessions >= 2, `Expected >= 2 sessions, got ${status.mcpSessions}`);
    }
  });

  it('Should allow Session A to reconnect', async () => {
    // Reconnect Session A (Initial GET again)
    const res = await request('/mcp?sessionId=sessionA', 'GET', undefined, {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Mcp-Session-Id': 'sessionA',
    });
    if (res.statusCode !== 200) {
      console.log('Session A Reconnect Failed. Body:', res.data);
    }
    assert.strictEqual(res.statusCode, 200, 'Session A Reconnect properties failed');
  });

  it('Should handle initialization post for Session A', async () => {
    // Send Initialize JSON-RPC to Session A
    const response = await request(
      '/mcp?sessionId=sessionA',
      'POST',
      {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0' },
        },
        id: 1,
      },
      {
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': 'sessionA',
      }
    );

    if (response.statusCode !== 200 && response.statusCode !== 202) {
      console.log('Initialize POST Failed. Body:', response.data);
    }
    assert.ok(
      response.statusCode === 200 || response.statusCode === 202,
      `Initialize POST failed: ${response.statusCode}`
    );
  });

  it('Should run_query successfully (Empty Result Debug)', async () => {
    // Inject a mock connector into the Daemon's registry to bypass real DBs
    const mockConnector = {
      id: 'mock',
      supportsPagination: false,
      validateConfig: () => undefined,
      runQuery: async function* () {
        // Yield one page with data
        yield {
          columns: [{ name: 'col1', type: 'integer' }],
          data: [[1], [2]],
          supportsPagination: false,
        };
      },
    };

    // Register mock connector
    // Access private property via cast
    (daemon as any).connectorRegistry.register(mockConnector);

    // Mock a connection profile that uses this connector
    const mockProfile = {
      id: 'conn-mock',
      name: 'Mock DB',
      type: 'mock',
      user: 'test',
    };

    // Inject mock connection manager
    const originalConnectionManager = (daemon as any).connectionManager;
    const mockConnectionManager = {
      getConnections: async () => [mockProfile],
      getConnection: async () => mockProfile,
    };
    (daemon as any).connectionManager = mockConnectionManager;
    // Also patch the executor which holds a reference
    (daemon as any).queryExecutor.connectionManager = mockConnectionManager;
    // AND patch the connectorRegistry because it is also held by reference!
    (daemon as any).queryExecutor.connectorRegistry = (daemon as any).connectorRegistry;

    // Execute run_query
    const res = await request(
      '/mcp?sessionId=sessionA',
      'POST',
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'run_query',
          arguments: {
            session: 'sessionA',
            sql: 'SELECT 1',
          },
        },
        id: 2,
      },
      {
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': 'sessionA',
      }
    );

    // Restore CM
    (daemon as any).connectionManager = originalConnectionManager;

    // Helper to parse SSE or JSON
    const parseResponse = (data: string) => {
      if (data.startsWith('event: message')) {
        const lines = data.split('\n');
        const dataLine = lines.find(l => l.startsWith('data: '));
        return dataLine ? JSON.parse(dataLine.substring(6)) : {};
      }
      return JSON.parse(data);
    };

    assert.strictEqual(res.statusCode, 200);
    const json = parseResponse(res.data);
    if (!json.result) {
      assert.fail(`Missing result in MCP response: ${JSON.stringify(json, null, 2)}`);
    }
    assert.strictEqual(json.result.content[0].type, 'text');
    assert.ok(json.result.content[0].text.includes('Query submitted'), 'Query should be submitted');

    // Check Tab Info to see if rows exist
    const tabIdMatch = json.result.content[0].text.match(/Tab ID: ([^.]+)/);
    const tabId = tabIdMatch[1];

    // Poll for success
    await new Promise(r => setTimeout(r, 500)); // wait for async execution

    const infoRes = await request(
      '/mcp?sessionId=sessionA',
      'POST',
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_tab_info',
          arguments: {
            session: 'sessionA',
            tabId: tabId,
          },
        },
        id: 3,
      },
      {
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': 'sessionA',
      }
    );

    const infoJson = parseResponse(infoRes.data);
    const infoText = infoJson.result.content[0].text;
    const info = JSON.parse(infoText);

    // Check results
    assert.strictEqual(
      info.status,
      'success',
      `Query status is ${info.status}. Error: ${info.error}`
    );
    assert.strictEqual(info.meta.totalRows, 2, 'Should have 2 rows');
  });

  it('Should return correct endpoint URI for auto-generated sessions', async () => {
    // Connect WITHOUT sessionId
    const res = await request(
      '/mcp',
      'GET',
      undefined,
      {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      true
    ); // Capture SSE

    assert.strictEqual(res.statusCode, 200, 'Should return 200 OK');
    // Expect: event: endpoint\ndata: /mcp?sessionId=...\n\n
    assert.ok(res.data.includes('event: endpoint'), 'Should receive endpoint event');

    // Extract endpoint
    const lines = res.data.split('\n');
    const dataLine = lines.find(l => l.startsWith('data: '));
    assert.ok(dataLine, 'Should have data line. Got: ' + res.data);

    const endpoint = dataLine?.substring(6).trim();
    // Verify it contains sessionId query param
    assert.ok(
      endpoint?.includes('sessionId='),
      `Endpoint '${endpoint}' should include sessionId param`
    );
  });
});
