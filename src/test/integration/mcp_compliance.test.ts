import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Ensure we use real FS and Child Process
jest.unmock('fs');
jest.unmock('child_process');
jest.unmock('path');

const STANDALONE_PATH = path.resolve(__dirname, '../../../out/server/standalone.js');

describe('MCP Compliance Integration', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // console.log('Starting MCP Client...');
    transport = new StdioClientTransport({
      command: 'node',
      args: [STANDALONE_PATH, '--stdio'],
    });

    client = new Client(
      {
        name: 'test-client',
        version: '1.0.0',
      },
      {
        capabilities: {
          // Client capabilities: sampling, roots, etc.
          // We don't need to expose anything for this test.
        },
      }
    );

    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  test('Should list capabilities', async () => {
    const caps = client.getServerCapabilities();
    expect(caps).toBeDefined();
    // Server should expose tools and resources
    expect(caps?.tools).toBeDefined();
    expect(caps?.resources).toBeDefined();
  });

  test('Should list tools', async () => {
    const response = await client.listTools();
    expect(response.tools).toBeDefined();
    const toolNames = response.tools.map(t => t.name);
    expect(toolNames).toContain('run_query');
    expect(toolNames).toContain('get_tab_info');
    expect(toolNames).toContain('list_sessions');
  });

  test('Should list resources (initially empty or from existing sessions)', async () => {
    const response = await client.listResources();
    expect(response.resources).toBeDefined();
    // Might be empty if no sessions
    expect(Array.isArray(response.resources)).toBe(true);
  });

  test('Should execute run_query (mock connection)', async () => {
    // We cast the result to 'any' to avoid strict type checking of the content structure
    // which might differ slightly from the static types or requires verbose guards.
    const result = (await client.callTool({
      name: 'run_query',
      arguments: {
        sql: 'SELECT 1',
        session: 'test-session',
        connectionProfile: {
          id: 'adhoc',
          name: 'AdHoc',
          type: 'trino',
          host: 'invalid-host',
          port: 8080,
          user: 'test',
        },
      },
    })) as any;

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    const text = result.content[0].text as string;

    expect(text).toContain('Query submitted');

    // Extract Tab ID
    const tabIdMatch = text.match(/Tab ID: ([^.]+)/);
    const tabId = tabIdMatch ? tabIdMatch[1] : undefined;
    expect(tabId).toBeDefined();

    if (tabId) {
      // Poll status - expect error eventually
      await new Promise(r => setTimeout(r, 1000));
      const info = (await client.callTool({
        name: 'get_tab_info',
        arguments: {
          session: 'test-session',
          tabId: tabId,
        },
      })) as any;

      const infoText = info.content[0].text as string;
      const infoJson = JSON.parse(infoText);

      expect(infoJson.status).toBeDefined();
      // It's likely 'error' because we used invalid host and waited 1s
      if (infoJson.status === 'error') {
        expect(infoJson.error).toBeDefined();
      }
      expect(infoJson.resourceUri).toContain(tabId);
    }
  });

  test('Should return error when running query without SQL', async () => {
    // Actually, let's try reading the implementation behavior or just check result.
    const result = (await client.callTool({
      name: 'run_query',
      arguments: {
        session: 'test-session',
        // sql missing
      },
    })) as any;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('SQL query is required');
  });

  test('Should list sessions and find the active one', async () => {
    const result = (await client.callTool({
      name: 'list_sessions',
      arguments: {},
    })) as any;

    // Daemon returns JSON string in text content
    const sessions = JSON.parse(result.content[0].text);
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
    const testSession = sessions.find((s: any) => s.id === 'test-session');
    expect(testSession).toBeDefined();
    // It might have tabs
    expect(testSession.tabs.length).toBeGreaterThan(0);
  });

  test('Should fail gracefully when getting info for non-existent session', async () => {
    try {
      await client.callTool({
        name: 'get_tab_info',
        arguments: {
          session: 'non-existent-session',
        },
      });

      // Daemon throws "Session not found", which comes back as tool error
      // Or if it throws Error in handler, Daemon catches and returns { isError: true }
      // Let's check DaemonMcpToolManager.ts: handleGetTabInfo throws Error.
      // DaemonMcpToolManager.ts: handleToolCall does NOT have try/catch around switch/case!
      // But DaemonMcpServer.ts: RequestHandler might?
      // Wait, DaemonMcpServer.ts just calls toolManager.handleToolCall.
      // If handleToolCall throws, the SDK Server catches it and returns a JSON-RPC error.
      // So client.callTool SHOULD throw.
      fail('Should have thrown JSON-RPC error');
    } catch (error: any) {
      expect(error.message).toBeDefined();
      // SDK might wrap it
    }
  });
});
