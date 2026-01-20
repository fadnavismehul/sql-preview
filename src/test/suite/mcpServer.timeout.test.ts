import * as assert from 'assert';
import * as sinon from 'sinon';
import { SqlPreviewMcpServer } from '../../modules/mcp/McpServer';
import { ResultsViewProvider } from '../../resultsViewProvider';
import { TabManager } from '../../services/TabManager';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

describe('MCP Server Timeout Logic Test Suite', () => {
  let sandbox: sinon.SinonSandbox;
  let mockResultsProvider: sinon.SinonStubbedInstance<ResultsViewProvider>;
  let mockTabManager: sinon.SinonStubbedInstance<TabManager>;
  let mcpServer: SqlPreviewMcpServer;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockResultsProvider = sandbox.createStubInstance(ResultsViewProvider);
    mockResultsProvider.log.returns();
    mockTabManager = sandbox.createStubInstance(TabManager);
    mcpServer = new SqlPreviewMcpServer(
      mockResultsProvider as unknown as ResultsViewProvider,
      mockTabManager as unknown as TabManager
    );
    clock = sandbox.useFakeTimers();
  });

  afterEach(async () => {
    await mcpServer.stop();
    sandbox.restore();
  });

  test('get_active_tab_info returns immediately if no timeout', async () => {
    // Re-setup to capture handler
    const serverStub = sandbox.stub((mcpServer as any).server, 'setRequestHandler');
    (mcpServer as any).setupHandlers(); // Re-run setup

    // Find the CallToolRequestSchema handler
    const callHandler = serverStub.args.find(arg => arg[0] === CallToolRequestSchema)?.[1];
    assert.ok(callHandler, 'Handler should be registered');

    sandbox.stub(mockTabManager, 'activeTabId').get(() => 'tab-1');
    mockTabManager.getTab.returns({
      id: 'tab-1',
      title: 'Loading Tab',
      query: 'SELECT 1',
      status: 'loading',
      columns: [],
      rows: [],
      sourceFileUri: undefined,
    } as any);

    const request = {
      params: {
        name: 'get_active_tab_info',
        arguments: {},
      },
    };

    const result = await callHandler(request);
    const content = JSON.parse(result.content[0].text);
    assert.strictEqual(content.status, 'loading');
  });

  test('get_active_tab_info waits if timeout provided and status is loading', async () => {
    const serverStub = sandbox.stub((mcpServer as any).server, 'setRequestHandler');
    (mcpServer as any).setupHandlers();
    const callHandler = serverStub.args.find(arg => arg[0] === CallToolRequestSchema)?.[1];

    sandbox.stub(mockTabManager, 'activeTabId').get(() => 'tab-1');

    // First call returns loading
    const loadingState = {
      id: 'tab-1',
      title: 'Tab',
      query: 'SELECT 1',
      status: 'loading',
      columns: [],
      rows: [],
      sourceFileUri: undefined,
    };

    // Success state
    const successState = {
      ...loadingState,
      status: 'success',
      rows: [[1]],
    };

    const getTabDataStub = mockTabManager.getTab;
    getTabDataStub.returns(loadingState as any);

    // After 1 second (5 polls of 200ms), switch to success
    setTimeout(() => {
      getTabDataStub.returns(successState as any);
    }, 1000);

    const request = {
      params: {
        name: 'get_active_tab_info',
        arguments: { timeout: 2 },
      },
    };

    const promise = callHandler(request);

    // Advance clock
    await clock.tickAsync(1500);

    const result = await promise;
    const content = JSON.parse(result.content[0].text);
    assert.strictEqual(content.status, 'success');
  });

  test('get_active_tab_info times out if status remains loading', async () => {
    const serverStub = sandbox.stub((mcpServer as any).server, 'setRequestHandler');
    (mcpServer as any).setupHandlers();
    const callHandler = serverStub.args.find(arg => arg[0] === CallToolRequestSchema)?.[1];

    sandbox.stub(mockTabManager, 'activeTabId').get(() => 'tab-1');
    mockTabManager.getTab.returns({
      id: 'tab-1',
      title: 'Tab',
      query: 'SELECT 1',
      status: 'loading',
      columns: [],
      rows: [],
      sourceFileUri: undefined,
    } as any);

    const request = {
      params: {
        name: 'get_active_tab_info',
        arguments: { timeout: 1 },
      },
    };

    const promise = callHandler(request);

    // Advance clock past timeout
    await clock.tickAsync(1200);

    const result = await promise;
    const content = JSON.parse(result.content[0].text);
    assert.strictEqual(content.status, 'loading');
  });
});
