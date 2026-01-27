/* eslint-disable */
import { SqlPreviewMcpServer } from '../../modules/mcp/McpServer';
import { ResultsViewProvider } from '../../resultsViewProvider';
import { TabManager } from '../../services/TabManager';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

describe('MCP Server Multi-Window Integration Test', () => {
  let sandbox: sinon.SinonSandbox;
  let mockResultsProvider: sinon.SinonStubbedInstance<ResultsViewProvider>;
  let mockTabManager: sinon.SinonStubbedInstance<TabManager>;
  let mcpServer: SqlPreviewMcpServer | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Mock Dependencies
    mockResultsProvider = sandbox.createStubInstance(ResultsViewProvider);
    mockResultsProvider.log.returns();
    mockTabManager = sandbox.createStubInstance(TabManager);

    // Stub configuration Default 3000
    const configStub = sandbox.stub(vscode.workspace, 'getConfiguration');
    configStub.returns({
      get: sandbox.stub().withArgs('mcpPort', 3000).returns(3000),
      update: sandbox.stub().resolves(),
      has: sandbox.stub().returns(true),
      inspect: sandbox.stub().returns(undefined),
    } as any);
  });

  afterEach(async () => {
    if (mcpServer) {
      await mcpServer.stop();
    }
    sandbox.restore();
  });

  test('Automatically finds next available port when default is busy', async () => {
    // Initialize MCP Server
    mcpServer = new SqlPreviewMcpServer(
      mockResultsProvider as unknown as ResultsViewProvider,
      mockTabManager as unknown as TabManager
    );

    // Mock app.listen on the instance
    const listenStub = sandbox.stub();
    (mcpServer as any).app.listen = listenStub;

    // First call (port 3000): Simulate EADDRINUSE
    const busyServer = {
      on: (event: string, cb: any) => {
        if (event === 'error') {
          setTimeout(() => cb({ code: 'EADDRINUSE' }), 1);
        }
      },
      close: (cb?: Function) => {
        if (cb) cb();
      },
      address: () => ({ port: 3000 }),
    };

    // Second call (port 3001): Simulate Success
    const successServer = {
      on: (_event: string, _cb: any) => {}, // No error
      close: (cb?: Function) => {
        if (cb) cb();
      },
      address: () => ({ port: 3001 }),
    };

    listenStub.onCall(0).callsFake((_port, _host, _cb) => {
      // Return busy server
      return busyServer;
    });

    listenStub.onCall(1).callsFake((_port, _host, cb) => {
      // Return success server AND call callback
      setTimeout(cb, 1);
      return successServer;
    });

    // Start Server
    await mcpServer.start();

    // Verify logic
    expect(listenStub.callCount).toBe(2);
    expect(listenStub.firstCall.args[0]).toBe(3000); // 1st attempt
    expect(listenStub.secondCall.args[0]).toBe(3001); // 2nd attempt

    expect(mcpServer.port).toBe(3001);
  });

  test('Skips multiple busy ports to find an open one', async () => {
    // Initialize MCP Server
    mcpServer = new SqlPreviewMcpServer(
      mockResultsProvider as unknown as ResultsViewProvider,
      mockTabManager as unknown as TabManager
    );

    // Mock app.listen
    const listenStub = sandbox.stub();
    (mcpServer as any).app.listen = listenStub;

    // Busy Server Template
    const createBusyServer = () => ({
      on: (event: string, cb: any) => {
        if (event === 'error') {
          setTimeout(() => cb({ code: 'EADDRINUSE' }), 1);
        }
      },
      close: (cb?: Function) => {
        if (cb) cb();
      },
      address: () => ({ port: 0 }),
    });

    // Success Server
    const successServer = {
      on: (_event: string, _cb: any) => {},
      close: (cb?: Function) => {
        if (cb) cb();
      },
      address: () => ({ port: 3003 }),
    };

    // 3000 busy
    listenStub.onCall(0).callsFake(() => createBusyServer());
    // 3001 busy
    listenStub.onCall(1).callsFake(() => createBusyServer());
    // 3002 busy
    listenStub.onCall(2).callsFake(() => createBusyServer());

    // 3003 success
    listenStub.onCall(3).callsFake((_port, _host, cb) => {
      setTimeout(cb, 1);
      return successServer;
    });

    // Start Server
    await mcpServer.start();

    // Verify logic
    expect(listenStub.callCount).toBe(4);
    expect(listenStub.getCall(0).args[0]).toBe(3000);
    expect(listenStub.getCall(1).args[0]).toBe(3001);
    expect(listenStub.getCall(2).args[0]).toBe(3002);
    expect(listenStub.getCall(3).args[0]).toBe(3003);

    expect(mcpServer.port).toBe(3003);
  });
});
