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

describe('ExportService Security', () => {
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
      // Execute callback immediately with dummy progress and token
      return callback({ report: jest.fn() }, { isCancellationRequested: false });
    });
    (vscode.commands.executeCommand as jest.Mock) = jest.fn();
    (vscode.window.showWarningMessage as jest.Mock) = jest.fn().mockResolvedValue('Continue');
  });

  it('should sanitize CSV injection (formula injection)', async () => {
    // Setup Save Dialog to return a .csv path
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      vscode.Uri.file('/tmp/export.csv')
    );

    // Setup Query Execution
    async function* mockGenerator() {
      // Yield columns first
      yield {
        columns: [{ name: 'val', type: 'varchar' }],
        data: [],
      };
      // Yield data
      yield {
        data: [
          ['=1+1'],
          ['@SUM(1,1)'],
          ['-10'], // Valid number, should NOT be escaped
          ['+5'], // Valid number, should NOT be escaped
          ['-cmd|'], // Not a number, should be escaped
        ],
      };
    }
    mockQueryExecutor.execute.mockReturnValue(mockGenerator());

    const tabData: TabData = {
      id: 'tab-1',
      title: 'Security Test',
      query: 'SELECT * FROM injection',
      columns: [],
      rows: [],
      status: 'success',
    };

    await exportService.exportResults(tabData);

    const lines = capturedOutput.trim().split('\n');
    // lines[0] is header "val"

    // Check line 1: =1+1 should be escaped
    assert.strictEqual(lines[1], "'=1+1", 'Should escape =1+1');

    // Check line 2: @SUM(1,1) should be escaped and quoted because of comma
    // Expected: "'@SUM(1,1)" (quoted because of comma)
    // Actually, createWriteStream mock captures chunks.
    // fs.createWriteStream().write() calls might be separate for header and rows.
    // Let's debug capturedOutput if test fails.

    assert.strictEqual(lines[2], `"'@SUM(1,1)"`, 'Should escape @SUM(1,1) and handle quotes');

    assert.strictEqual(lines[3], '-10', 'Should NOT escape -10');
    assert.strictEqual(lines[4], '+5', 'Should NOT escape +5');
    assert.strictEqual(lines[5], "'-cmd|", 'Should escape -cmd|');
  });
});
