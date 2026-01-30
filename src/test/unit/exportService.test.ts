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

    // THIS ASSERTION WILL FAIL currently because it exports arrays
    assert.ok(!Array.isArray(output[0]), 'Rows should be objects, not arrays');
    assert.strictEqual(output[0].id, 1);
    assert.strictEqual(output[0].name, 'Alice');
  });

  it('should escape CSV injection payloads', async () => {
    // Setup Save Dialog to return a .csv path
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      vscode.Uri.file('/tmp/export.csv')
    );

    // Setup Query Execution
    async function* mockGenerator() {
      yield {
        columns: [{ name: 'payload', type: 'varchar' }],
        data: [['=cmd|/C calc!A0'], ['+1+1'], ['@SUM(1,1)'], ['-1+1'], ['Safe'], ['-100'], ['+50']],
      };
    }
    mockQueryExecutor.execute.mockReturnValue(mockGenerator());

    const tabData: TabData = {
      id: 'tab-1',
      title: 'Injection',
      query: 'SELECT *',
      columns: [],
      rows: [],
      status: 'success',
    };

    await exportService.exportResults(tabData);

    const lines = capturedOutput.trim().split('\n');
    // Header
    assert.strictEqual(lines[0], 'payload');

    // Rows
    assert.strictEqual(lines.length, 8, 'Should have header + 7 rows');

    // We expect them to be escaped with a single quote or similar mechanism if they start with triggers
    // The current implementation does NOT do this, so this test asserts the DESIRED behavior.

    assert.ok(lines[1] && lines[1].startsWith("'="), `Row 1 not escaped: ${lines[1]}`);
    assert.ok(lines[2] && lines[2].startsWith("'+"), `Row 2 not escaped: ${lines[2]}`);
    // Row 3 contains a comma, so it will be double-quoted by CSV rules AND prefixed with '
    // Expected: "'@SUM(1,1)"
    assert.ok(
      lines[3] && (lines[3].startsWith("'@") || lines[3].startsWith('"\'' + '@')),
      `Row 3 not escaped: ${lines[3]}`
    );
    assert.ok(lines[4] && lines[4].startsWith("'-"), `Row 4 not escaped: ${lines[4]}`);
    assert.strictEqual(lines[5], 'Safe');
    // Regression check: valid numbers should NOT be escaped
    assert.strictEqual(lines[6], '-100', 'Negative number should not be escaped');
    assert.strictEqual(lines[7], '+50', 'Positive number should not be escaped');
  });
});
