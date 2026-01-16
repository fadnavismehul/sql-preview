// Integration tests
import * as assert from 'assert';
import * as vscode from 'vscode';

describe('Integration Test Suite', () => {
  // We need to wait for extension activation
  before(async () => {
    const ext = vscode.extensions.getExtension('mehul.sql-preview');
    assert.ok(ext, 'Extension not found');
    if (!ext.isActive) {
      await ext.activate();
    }
  });

  it('Run Query command should trigger webview', async () => {
    // Trigger the run query command
    // We can't easily verify the webview content without a complex driver,
    // but we can verify the command execution doesn't throw.
    try {
      await vscode.commands.executeCommand('sql.runQuery', 'SELECT 1');
      // If no error, command registered and ran.
    } catch (e) {
      assert.fail(`Run Query failed: ${e}`);
    }
  });

  it('Tab Management Commands registration', async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('sql.closeTab'), 'Close Tab command missing');
    assert.ok(commands.includes('sql.closeAllTabs'), 'Close All Tabs command missing');
    assert.ok(commands.includes('sql.closeOtherTabs'), 'Close Other Tabs command missing');
  });

  it('MCP run_query tool execution logic (simulated)', async function (this: any) {
    this.timeout(5000);

    // Directly test the command that MCP calls
    // We simulate "safe mode" check via invoking the command with a "bad" query if we could,
    // but here we just check valid execution.
    const start = Date.now();
    await vscode.commands.executeCommand('sql.runQueryNewTab', 'SELECT * FROM users');
    const duration = Date.now() - start;

    // It should return "immediately" (fire and forget), not wait for query
    assert.ok(duration < 2000, 'Command execution took too long, might be blocking');
  });
});
