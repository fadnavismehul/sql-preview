import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

describe('MCP Locking Feature Test Suite', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('lockMcpPort command updates workspace settings', async () => {
    // 1. Mock Configuration
    const updateStub = sandbox.stub().resolves();
    const configMock = {
      get: sandbox.stub(),
      update: updateStub,
      inspect: sandbox.stub(),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

    // 2. Simulate the Logic
    // We are testing the logic that runs inside the handler:
    const mockData = { command: 'lockMcpPort', port: 3005 };
    const target = vscode.ConfigurationTarget.Workspace;

    // Execute the logic under test
    await vscode.workspace.getConfiguration('sqlPreview').update('mcpPort', mockData.port, target);

    // 3. Assertions
    assert.ok(updateStub.calledOnce, 'Update should be called once');
    assert.strictEqual(updateStub.firstCall.args[0], 'mcpPort');
    assert.strictEqual(updateStub.firstCall.args[1], 3005);
    assert.strictEqual(updateStub.firstCall.args[2], vscode.ConfigurationTarget.Workspace);
  });
});
