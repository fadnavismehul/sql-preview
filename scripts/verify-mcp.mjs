import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '../out/server/standalone.js');

async function main() {
  console.log('🧪 Starting MCP Server Verification...');
  console.log(`Target Server: ${SERVER_PATH}`);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH, '--stdio'],
    env: {
      ...process.env,
      MCP_PORT: '8553', // Use a unique port for this test
      SQL_PREVIEW_LOG_LEVEL: 'ERROR', // Keep it quiet
    },
  });

  const client = new Client({ name: 'verify-client', version: '1.0.0' }, { capabilities: {} });

  try {
    console.log('🔌 Connecting to server...');
    await client.connect(transport);
    console.log('✅ Connected successfully!');

    console.log('\n🛠️  Fetching Tools...');
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tools:`);
    tools.tools.forEach(t => console.log(` - ${t.name}: ${t.description?.substring(0, 50)}...`));

    console.log('\n📂 Fetching Resources...');
    const resources = await client.listResources();
    console.log(`Found ${resources.resources.length} resources:`);
    resources.resources.forEach(r => console.log(` - ${r.uri}`));

    console.log('\n✨ Verification Passed!');
  } catch (error) {
    console.error('\n❌ Verification Failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
