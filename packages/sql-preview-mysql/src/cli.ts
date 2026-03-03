import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ErrorCode,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';

import MySQLConnector from './index';

async function runMcpServer() {
    const server = new Server(
        { name: 'sql-preview-mysql', version: '1.0.0' },
        { capabilities: { tools: {} } },
    );

    const connector = new MySQLConnector();

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'execute_query',
                description: 'Execute a SQL query against MySQL/MariaDB and return results as JSON.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'SQL query to execute.' },
                        config: { type: 'object', description: 'Connector configuration object.' },
                    },
                    required: ['query', 'config'],
                },
            },
        ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async request => {
        if (request.params.name !== 'execute_query') {
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
        const { query, config } = request.params.arguments as any;
        try {
            const results: any[] = [];
            for await (const page of connector.runQuery(query, config || {})) {
                results.push(page);
            }
            return { content: [{ type: 'text', text: JSON.stringify(results) }] };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: JSON.stringify({ error: msg }), isError: true }] };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MySQL MCP Server running on stdio');
}

async function runCli() {
    const args = process.argv.slice(2);
    let query = '';
    let configStr = '{}';
    let authStr = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--query' && i + 1 < args.length) query = args[++i];
        if (args[i] === '--config' && i + 1 < args.length)
            configStr = Buffer.from(args[++i], 'base64').toString('utf-8');
        if (args[i] === '--auth' && i + 1 < args.length)
            authStr = Buffer.from(args[++i], 'base64').toString('utf-8');
    }

    if (!query) {
        console.error('Usage: sql-preview-mysql [--mcp] | [--query <sql> --config <base64_json>]');
        process.exit(1);
    }

    const config = JSON.parse(configStr);
    const connector = new MySQLConnector();

    try {
        for await (const page of connector.runQuery(query, config, authStr || undefined)) {
            console.log(JSON.stringify(page));
        }
        process.exit(0);
    } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
    }
}

const isMcp = process.argv.includes('--mcp');
if (isMcp) {
    runMcpServer().catch(e => { console.error('MCP Server Error:', e); process.exit(1); });
} else {
    runCli().catch(e => { console.error('CLI Error:', e); process.exit(1); });
}
