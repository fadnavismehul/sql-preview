import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import WebSocket from 'ws';

(global as any).WebSocket = WebSocket;

async function runMcpClient() {
  console.log('Connecting to Daemon via WebSocket MCP...');

  // Use a random session ID
  const sessionId = `test-mcp-ws-${Date.now()}`;
  const wsUrl = new URL(`ws://127.0.0.1:8414/mcp/ws?sessionId=${sessionId}`);

  const transport = new WebSocketClientTransport(wsUrl);
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    console.log('✅ Connected successfully!');

    console.log('Fetching available tools...');
    const result = await client.listTools();

    console.log('✅ Found tools:', result.tools.map(t => t.name).join(', '));

    // Test if run_query is in the list
    if (result.tools.some(t => t.name === 'run_query')) {
      console.log('✅ Tool "run_query" is available!');
    } else {
      console.error('❌ Missing "run_query" tool');
    }

    console.log('Closing connection...');
    await client.close();
    console.log('✅ Disconnected');
  } catch (err) {
    console.error('❌ Connection or Execution Failed:', err);
    process.exit(1);
  }
}

runMcpClient().catch(console.error);
