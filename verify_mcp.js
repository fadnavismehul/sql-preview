/* eslint-disable */
const http = require('http');

const PORT = 8414;

// 1. GET /sse to get endpoint
const req = http.request(
  {
    host: 'localhost',
    port: PORT,
    path: '/sse',
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
    },
  },
  res => {
    console.log(`GET /sse Status: ${res.statusCode}`);

    res.on('data', chunk => {
      const text = chunk.toString();
      console.log('SSE Chunk:', text);

      // Parse endpoint from event: endpoint\ndata: ...
      const match = text.match(/event: endpoint\s+data: (\S+)/);
      if (match && match[1]) {
        let endpoint = match[1];
        console.log('Found Endpoint:', endpoint);

        // 2. POST to endpoint
        postInitialize(endpoint);
        // req.destroy(); // DO NOT CLOSE SSE yet! The session depends on it.
      }
    });
  }
);

req.on('error', e => console.error('SSE Error:', e));
req.end();

function postInitialize(endpointUrl) {
  // Construct path from full URL or relative
  let path = endpointUrl;
  if (endpointUrl.startsWith('http')) {
    const u = new URL(endpointUrl);
    path = u.pathname + u.search;
  }

  console.log(`Sending Initialize to ${path}...`);

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-script', version: '1.0' },
    },
  });

  const postReq = http.request(
    {
      host: 'localhost',
      port: PORT,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    res => {
      console.log(`POST Initialize Status: ${res.statusCode}`);
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        console.log('POST Response:', data);

        // 3. List Tools
        const initializedNotif = JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        });
        // We really should send this separately but for test, just trying ListTools next

        postListTools(path);
      });
    }
  );

  postReq.on('error', e => console.error('POST Error:', e));
  postReq.write(body);
  postReq.end();
}

function postListTools(path) {
  console.log('Sending ListTools...');
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });

  const postReq = http.request(
    {
      host: 'localhost',
      port: PORT,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    res => {
      console.log(`POST ListTools Status: ${res.statusCode}`);
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        console.log('ListTools Response:', data);
      });
    }
  );

  postReq.write(body);
  postReq.end();
}
