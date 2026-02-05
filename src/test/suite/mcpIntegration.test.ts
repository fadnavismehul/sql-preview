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
    body?: any
  ): Promise<{ statusCode?: number; data: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: 'localhost',
          port: DAEMON_PORT,
          path: path,
          method: method,
          headers: body ? { 'Content-Type': 'application/json' } : {},
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode || 0, data }));
        }
      );
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

  it('MCP Endpoint should be reachable (StreamableHTTP)', async () => {
    // Verify we can connect to /mcp with proper initialization
    return new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: 'localhost',
          port: DAEMON_PORT,
          path: '/mcp',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: '*/*',
          },
        },
        res => {
          if (res.statusCode === 200) {
            req.destroy(); // Close immediately on success
            resolve();
          } else {
            console.log('Failed Status:', res.statusCode);
            res.resume(); // Consume data
            reject(new Error(`MCP endpoint returned ${res.statusCode}`));
          }
        }
      );
      req.on('error', reject);

      // Send Initialization
      req.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'health-check', version: '1.0' },
          },
          id: 1,
        })
      );
      req.end();
    });
  });
});
