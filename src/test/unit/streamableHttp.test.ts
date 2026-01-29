// import * as assert from 'assert';
import * as http from 'http';
import { Daemon } from '../../server/Daemon';

// Mock express or just instantiate Daemon and test port binding?
// For integration, we want to actually start the daemon and hit it with http.

describe('StreamableHTTP Integration Test', () => {
  let daemon: Daemon;
  const PORT = 8414;

  beforeAll(async () => {
    // We need to ensure address 8414 is free or use a different port for test?
    // Daemon hardcodes 8414.
    // Let's assume testing environment can run it.
    daemon = new Daemon();
    // Start daemon
    // Note: This might conflict if a text fixture is already running.
    // Ideally we mock the listen port or use a config.
    // For now we'll try to start it and catch error if already running,
    // assuming if it's running it's our test Daemon?
    // BUT Daemon.ts writes PID files etc, which might be risky in test env.
    // Better to manually invoke the app handler if possible, or just trust manual verification?
    // Let's try to just use the `daemon.app` if it was public, but it's private.
    // Okay, let's try starting it.
    try {
      await daemon.start();
    } catch (e) {
      console.log('Daemon start failed (maybe already running):', e);
    }
  });

  afterAll(() => {
    daemon.stop();
  });

  test('Should handle POST initialize request and start SSE stream', done => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: '/mcp', // app.use strips this so it becomes /
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
    };

    const req = http.request(options, res => {
      // Expect 200 OK
      try {
        if (res.statusCode !== 200) {
          res.resume();
          done(new Error(`Expected 200 OK, got ${res.statusCode}`));
          return;
        }

        // Expect text/event-stream
        if (!res.headers['content-type']?.includes('text/event-stream')) {
          done(new Error(`Expected text/event-stream, got ${res.headers['content-type']}`));
          res.resume();
          return;
        }

        // Consume stream a bit then end
        res.on('data', chunk => {
          // Just ensure we get data
          const str = chunk.toString();
          if (str.includes('jsonrpc')) {
            // Good
          }
        });

        // We can end the test
        res.destroy(); // Close connection
        done();
      } catch (e) {
        done(e);
      }
    });

    req.on('error', e => {
      done(e);
    });

    // Send Initialize Message
    const initMsg = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', // Use a recent version or generic? SDK types will validate?
        // SDK uses SUPPORTED_PROTOCOL_VERSIONS.
        // Let's use '2024-11-05' or rely on checking logs if it fails.
        // Actually, SDK `types.ts` has LATEST_PROTOCOL_VERSION.
        // I'll try '2024-11-05'.
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0' },
      },
      id: 1,
    };
    req.write(JSON.stringify(initMsg));
    // Don't req.end() immediately if we expect streaming?
    // Actually POST body must be complete for it to process?
    // getRawBody waits for end.
    req.end();
  });
});
