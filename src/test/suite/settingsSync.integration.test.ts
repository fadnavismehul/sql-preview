import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Settings Synchronization Logic', () => {
  test('Should prioritize Workspace Target only if value exists', async () => {
    // This test validates the logic pattern used in ResultsViewProvider.saveSettings

    const key = 'sqlPreview.maxRowsToDisplay';
    const config = vscode.workspace.getConfiguration();

    // 1. Ensure clean state (undefined in workspace)
    await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);

    // 2. Simulate "Save" logic: Inspect
    const inspect = config.inspect(key);
    const target =
      inspect?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    // 3. functional assert: Should be Global
    assert.strictEqual(
      target,
      vscode.ConfigurationTarget.Global,
      'Should default to Global when no workspace override exists'
    );

    // 4. Set a workspace value
    await config.update(key, 123, vscode.ConfigurationTarget.Workspace);

    // 5. Simulate "Save" logic again
    const inspect2 = config.inspect(key);
    const target2 =
      inspect2?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    // 6. functional assert: Should be Workspace
    assert.strictEqual(
      target2,
      vscode.ConfigurationTarget.Workspace,
      'Should target Workspace when override exists'
    );

    // Cleanup
    await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
  });
});
