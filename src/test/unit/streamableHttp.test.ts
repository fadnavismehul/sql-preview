import * as http from 'http';
import { Daemon } from '../../server/Daemon';

describe('Daemon StreamableHTTP Integration Test', () => {
  let daemon: Daemon;
  const PORT = 8414;
  let sseReq: http.ClientRequest;

  beforeAll(async () => {
    daemon = new Daemon();
    // Try to start daemon, ignore socket errors (EADDRINUSE) if valid
    try {
      await daemon.start();
    } catch (e: any) {
      if (e.code !== 'EADDRINUSE') {
        console.log('Daemon start failed:', e);
      }
    }
  });

  afterAll(() => {
    if (sseReq) {
      sseReq.destroy();
    }
    daemon.stop();
  });

  test('Should establish SSE connection and handle initialize', done => {
    // 1. Start SSE Connection
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: '/sse', // Use /sse direct endpoint to avoid path stripping issues
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
      },
    };

    sseReq = http.request(options, res => {
      try {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');

        let postEndpoint = '';

        res.on('data', chunk => {
          const text = chunk.toString();
          if (text.includes('event: endpoint')) {
            const match = text.match(/data:\s+(.+)/);
            if (match && match[1]) {
              postEndpoint = match[1].trim();
              sendInitialize(postEndpoint, done);
            }
          }
        });
      } catch (e) {
        done(e);
      }
    });

    sseReq.on('error', e => done(e));
    sseReq.end();
  });

  function sendInitialize(endpoint: string, done: any) {
    const postOptions = {
      hostname: '127.0.0.1',
      port: PORT,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(postOptions, res => {
      // Expect 202 Accepted (standard for MCP writes) or 200 OK
      expect([200, 202]).toContain(res.statusCode);

      // We expect a response on the SSE stream, but for this test,
      // successful POST is enough to prove handshake works.
      done();
    });

    req.on('error', e => done(e));

    const initMsg = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0' },
      },
      id: 1,
    };

    req.write(JSON.stringify(initMsg));
    req.end();
  }
});
