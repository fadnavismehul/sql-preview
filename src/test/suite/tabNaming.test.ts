import * as assert from 'assert';

import * as sinon from 'sinon';
import { generateTabTitle } from '../../extension';
import { mockWorkspaceConfig } from '../setup';

describe('Tab Naming Tests', () => {
  beforeEach(() => {
    sinon.restore();
    // Assuming mockWorkspaceConfig is already set up to mock vscode.workspace.getConfiguration
    // If setup.ts mocks it globally, we can use it.
    // If not, we stub it here.
    if (!mockWorkspaceConfig.get) {
      // Create stub if not present (although setup.ts usually does)
      // But here we might need to verify setup.
    }
  });

  afterEach(() => {
    sinon.restore();
  });

  test('should use file-sequential naming by default', () => {
    // Mock get to return 'file-sequential'
    mockWorkspaceConfig.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'tabNaming') {
        return 'file-sequential';
      }
      return defaultValue;
    });

    const sql = 'SELECT * FROM users';
    const sourceUri = 'file:///path/to/script.sql';
    const count = 5;

    const title = generateTabTitle(sql, sourceUri, count);
    assert.strictEqual(title, 'Result 5');
  });

  test('should use query-snippet naming when configured', () => {
    mockWorkspaceConfig.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'tabNaming') {
        return 'query-snippet';
      }
      return defaultValue;
    });

    const sql = 'SELECT * FROM users WHERE id = 1';
    const sourceUri = 'file:///path/to/script.sql';
    const count = 5;

    // Expect first 16 chars
    const expected = 'SELECT * FROM us';
    const title = generateTabTitle(sql, sourceUri, count);
    assert.strictEqual(title, expected);
  });

  test('should handle short query snippets', () => {
    mockWorkspaceConfig.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'tabNaming') {
        return 'query-snippet';
      }
      return defaultValue;
    });

    const sql = 'SELECT 1';
    const title = generateTabTitle(sql, undefined, 1);
    assert.strictEqual(title, 'SELECT 1');
  });

  test('should fallback to Result if no sourceUri in sequential mode', () => {
    mockWorkspaceConfig.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'tabNaming') {
        return 'file-sequential';
      }
      return defaultValue;
    });

    const sql = 'SELECT 1';
    const title = generateTabTitle(sql, undefined, 1);
    assert.strictEqual(title, 'Result');
  });
});
