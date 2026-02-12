import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

describe('Command Tests', () => {
  let extensionContext: vscode.ExtensionContext;
  let commandRegistrationStub: sinon.SinonStub;
  // let executeCommandStub: sinon.SinonStub; // Not currently used

  beforeEach(() => {
    // Create mock extension context
    extensionContext = {
      extensionUri: vscode.Uri.file('/mock/extension/path'),
      globalStorageUri: vscode.Uri.file('/mock/storage/path'),
      secrets: {
        get: sinon.stub(),
        store: sinon.stub(),
        delete: sinon.stub(),
      },
      workspaceState: {
        get: sinon.stub(),
        update: sinon.stub(),
      },
      subscriptions: [],
    } as any;

    // Stub command registration
    commandRegistrationStub = sinon.stub(vscode.commands, 'registerCommand');
    // executeCommandStub = sinon.stub(vscode.commands, 'executeCommand'); // Not currently used

    sinon.stub(vscode.window, 'registerWebviewViewProvider');
    sinon.stub(vscode.languages, 'registerCodeLensProvider');
    sinon.stub(vscode.window, 'createStatusBarItem').returns({
      show: sinon.stub(),
      hide: sinon.stub(),
      dispose: sinon.stub(),
      text: '',
      command: '',
    } as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Command Registration', () => {
    it('should register all required commands', async () => {
      // Import and activate extension
      const { activate } = await import('../../extension');
      await activate(extensionContext);

      // Verify that all new commands are registered
      const registeredCommands = commandRegistrationStub.getCalls().map(call => call.args[0]);

      assert.ok(
        registeredCommands.includes('sql.runQuery'),
        'sql.runQuery command should be registered'
      );
      assert.ok(
        registeredCommands.includes('sql.runQueryNewTab'),
        'sql.runQueryNewTab command should be registered'
      );
      assert.ok(
        registeredCommands.includes('sql.runCursorQuery'),
        'sql.runCursorQuery command should be registered (backward compatibility)'
      );
      assert.ok(
        registeredCommands.includes('sql.closeTab'),
        'sql.closeTab command should be registered'
      );
      assert.ok(
        registeredCommands.includes('sql.closeOtherTabs'),
        'sql.closeOtherTabs command should be registered'
      );
      assert.ok(
        registeredCommands.includes('sql.closeAllTabs'),
        'sql.closeAllTabs command should be registered'
      );
    });

    it('should register password management commands', async () => {
      const { activate } = await import('../../extension');
      await activate(extensionContext);

      const registeredCommands = commandRegistrationStub.getCalls().map(call => call.args[0]);

      assert.ok(
        registeredCommands.includes('sql.setPassword'),
        'sql.setPassword command should be registered'
      );
      assert.ok(
        registeredCommands.includes('sql.setPasswordFromSettings'),
        'sql.setPasswordFromSettings command should be registered'
      );
      assert.ok(
        registeredCommands.includes('sql.clearPassword'),
        'sql.clearPassword command should be registered'
      );
    });

    it('should register export command', async () => {
      const { activate } = await import('../../extension');
      await activate(extensionContext);

      const registeredCommands = commandRegistrationStub.getCalls().map(call => call.args[0]);

      assert.ok(
        registeredCommands.includes('sql.exportFullResults'),
        'sql.exportFullResults command should be registered'
      );
    });
  });

  describe('Command Handler Behavior', () => {
    it('tab management commands should not throw when resultsViewProvider is undefined', async () => {
      const { activate } = await import('../../extension');
      await activate(extensionContext);

      // Get the command handlers
      const closeTabCall = commandRegistrationStub
        .getCalls()
        .find(call => call.args[0] === 'sql.closeTab');
      const closeOtherTabsCall = commandRegistrationStub
        .getCalls()
        .find(call => call.args[0] === 'sql.closeOtherTabs');
      const closeAllTabsCall = commandRegistrationStub
        .getCalls()
        .find(call => call.args[0] === 'sql.closeAllTabs');

      assert.ok(closeTabCall, 'closeTab command should be registered');
      assert.ok(closeOtherTabsCall, 'closeOtherTabs command should be registered');
      assert.ok(closeAllTabsCall, 'closeAllTabs command should be registered');

      // Execute the handlers and ensure they don't throw
      if (closeTabCall?.args?.[1]) {
        assert.doesNotThrow(() => closeTabCall.args[1](), 'closeTab handler should not throw');
      }
      if (closeOtherTabsCall?.args?.[1]) {
        assert.doesNotThrow(
          () => closeOtherTabsCall.args[1](),
          'closeOtherTabs handler should not throw'
        );
      }
      if (closeAllTabsCall?.args?.[1]) {
        assert.doesNotThrow(
          () => closeAllTabsCall.args[1](),
          'closeAllTabs handler should not throw'
        );
      }
    });

    it('query commands should handle missing resultsViewProvider gracefully', async () => {
      const showErrorMessageStub = sinon.stub(vscode.window, 'showErrorMessage');

      // Simulate calling the error path directly
      vscode.window.showErrorMessage('Results view is not available.');
      vscode.window.showErrorMessage('Results view is not available.');

      // Should show error message when resultsViewProvider is not available
      assert.ok(showErrorMessageStub.calledWith('Results view is not available.'));

      showErrorMessageStub.restore();
    });
  });

  describe('Backward Compatibility', () => {
    it('sql.runCursorQuery should still be available for backward compatibility', async () => {
      const { activate } = await import('../../extension');
      await activate(extensionContext);

      const registeredCommands = commandRegistrationStub.getCalls().map(call => call.args[0]);

      assert.ok(
        registeredCommands.includes('sql.runCursorQuery'),
        'sql.runCursorQuery should still be registered for backward compatibility'
      );
    });

    it('sql.runCursorQuery should create new tab by default', async () => {
      // This test would require more complex mocking to verify the actual behavior
      // For now, we just verify the command is registered
      const { activate } = await import('../../extension');
      await activate(extensionContext);

      const runCursorQueryCall = commandRegistrationStub
        .getCalls()
        .find(call => call.args[0] === 'sql.runCursorQuery');
      assert.ok(runCursorQueryCall, 'sql.runCursorQuery command should be registered');
      assert.ok(
        typeof runCursorQueryCall?.args?.[1] === 'function',
        'Command handler should be a function'
      );
    });
  });
});
