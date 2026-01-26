import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ExportService } from '../../services/ExportService';
import { QueryExecutor } from '../../core/execution/QueryExecutor';
import { TabData } from '../../common/types';

// Mock fs
jest.mock('fs', () => ({
  createWriteStream: jest.fn(),
}));

describe('ExportService', () => {
  let exportService: ExportService;
  let mockQueryExecutor: jest.Mocked<QueryExecutor>;
  let mockWriteStream: any;
  let capturedOutput: string;

  beforeEach(() => {
    capturedOutput = '';
    mockWriteStream = {
      write: jest.fn(chunk => {
        capturedOutput += chunk;
        return true;
      }),
      end: jest.fn(),
    };
    (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);

    mockQueryExecutor = {
      execute: jest.fn(),
    } as any;

    exportService = new ExportService(mockQueryExecutor);

    // Mock VS Code API
    (vscode.window.showSaveDialog as jest.Mock) = jest.fn();
    (vscode.window.withProgress as jest.Mock) = jest.fn((_options, callback) => {
      // Execute callback immediately
      return callback({ report: jest.fn() }, { isCancellationRequested: false });
    });
    (vscode.commands.executeCommand as jest.Mock) = jest.fn();
  });

  test('should export result as JSON objects', async () => {
    // Setup Save Dialog to return a .json path
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      vscode.Uri.file('/tmp/export.json')
    );

    // Setup Query Execution
    async function* mockGenerator() {
      yield {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'varchar' },
        ],
        data: [
          [1, 'Alice'],
          [2, 'Bob'],
        ],
      };
    }
    mockQueryExecutor.execute.mockReturnValue(mockGenerator());

    const tabData: TabData = {
      id: 'tab-1',
      title: 'Test Query',
      query: 'SELECT * FROM users',
      columns: [],
      rows: [],
      status: 'success',
    };

    await exportService.exportResults(tabData);

    const output = JSON.parse(capturedOutput);

    // Expect array of objects
    assert.ok(Array.isArray(output), 'Output should be an array');
    assert.strictEqual(output.length, 2);

    // THIS ASSERTION WILL FAIL currently because it exports arrays
    assert.ok(!Array.isArray(output[0]), 'Rows should be objects, not arrays');
    assert.strictEqual(output[0].id, 1);
    assert.strictEqual(output[0].name, 'Alice');
  });
});
