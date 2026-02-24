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
    (vscode.window.showWarningMessage as jest.Mock) = jest.fn().mockResolvedValue('Continue');
  });

  it('should export result as JSON objects', async () => {
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

    assert.ok(!Array.isArray(output[0]), 'Rows should be objects, not arrays');
    assert.strictEqual(output[0].id, 1);
    assert.strictEqual(output[0].name, 'Alice');
  });

  it('should pass tab.id to QueryExecutor.execute', async () => {
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      vscode.Uri.file('/tmp/export.csv')
    );

    async function* mockGenerator() {
      yield {
        columns: [{ name: 'id', type: 'integer' }],
        data: [[1]],
      };
    }
    mockQueryExecutor.execute.mockReturnValue(mockGenerator());

    const tabData: TabData = {
      id: 'tab-123',
      title: 'Test Query',
      query: 'SELECT 1',
      columns: [],
      rows: [],
      status: 'success',
    };

    await exportService.exportResults(tabData);

    expect(mockQueryExecutor.execute).toHaveBeenCalledWith(
      tabData.query,
      undefined, // contextUri
      undefined, // connectionId
      'tab-123'
    );
  });

  it('should handle empty first page columns without skipping headers for CSV', async () => {
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      vscode.Uri.file('/tmp/export.csv')
    );

    async function* mockGenerator() {
      // First page simulating an immediate yield without columns
      yield {
        data: [],
      };
      // Second page with columns and data
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

    // Should contain headers from the second page
    expect(capturedOutput).toContain('id,name');
    expect(capturedOutput).toContain('1,Alice');
  });

  it('should append suffixes to duplicate column names for JSON export', async () => {
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      vscode.Uri.file('/tmp/export.json')
    );

    async function* mockGenerator() {
      yield {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'varchar' },
          { name: 'name', type: 'varchar' }, // Duplicate column
        ],
        data: [[1, 'Alice', 'Smith']],
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
    expect(output[0].id).toBe(1);
    expect(output[0].name).toBe('Alice');
    expect(output[0].name_1).toBe('Smith');
  });
});
