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

  it('MCP SSE Endpoint should be reachable', async () => {
    // Just verify we can connect to /sse without immediate error
    // A full SSE test is complex in this setup, but connecting is a good smoke test
    return new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: 'localhost',
          port: DAEMON_PORT,
          path: '/sse',
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
        },
        res => {
          if (res.statusCode === 200) {
            req.destroy(); // Close immediately, we just wanted to see if it accepts
            resolve();
          } else {
            reject(new Error(`SSE endpoint returned ${res.statusCode}`));
          }
        }
      );
      req.on('error', reject);
      req.end();
    });
  });
});
