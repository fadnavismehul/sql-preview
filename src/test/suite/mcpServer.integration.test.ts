import * as assert from 'assert';
import * as vscode from 'vscode';
import axios from 'axios';

describe('MCP Server Integration Test Suite', () => {
  // Port to use for testing
  const TEST_PORT = 3099;

  beforeEach(async () => {
    // Ensure extension is active and configured
    const config = vscode.workspace.getConfiguration('sqlPreview');
    await config.update('mcpEnabled', true, vscode.ConfigurationTarget.Global);
    await config.update('mcpPort', TEST_PORT, vscode.ConfigurationTarget.Global);

    const ext = vscode.extensions.getExtension('mehul.sql-preview');
    assert.ok(ext, 'Extension should be found');

    if (!ext.isActive) {
      await ext.activate();
    }

    // Allow some time for the server to start/restart after config change
    await new Promise(resolve => setTimeout(resolve, 3000));
  });

  afterEach(async () => {
    // Cleanup config?
    // Often cleaner to leave configured for debugging if fails, but good citizen cleans up.
    // await vscode.workspace.getConfiguration('sqlPreview').update('mcpEnabled', undefined, vscode.ConfigurationTarget.Global);
  });

  it('MCP Server Health Check Endpoint', async () => {
    try {
      const response = await axios.get(`http://localhost:${TEST_PORT}/`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.data, 'SQL Preview MCP Server is running.');
    } catch (err: any) {
      assert.fail(`Failed to connect to MCP server: ${err.message}`);
    }
  });

  it('MCP Server SSE Endpoint Rejects Missing Session', async () => {
    try {
      await axios.post(`http://localhost:${TEST_PORT}/messages`, {});
      assert.fail('Should have rejected request without session');
    } catch (err: any) {
      assert.strictEqual(err.response?.status, 400); // Bad Request (Session ID required)
    }
  });
});
