const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function run() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['./out/server/standalone.js', '--stdio']
  });
  const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const result = await client.listTools();
  console.log(JSON.stringify(result.tools.find(t => t.name === 'run_query')._meta, null, 2));
  process.exit(0);
}
run().catch(console.error);
