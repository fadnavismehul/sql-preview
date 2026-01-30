import * as assert from 'assert';

import * as sinon from 'sinon';
import { generateTabTitle } from '../../extension';
import { mockWorkspaceConfig } from '../setup';

describe('Tab Naming Tests', () => {
  beforeEach(() => {
    sinon.restore();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should use file-sequential naming by default', () => {
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

  it('should use query-snippet naming when configured', () => {
    mockWorkspaceConfig.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'tabNaming') {
        return 'query-snippet';
      }
      return defaultValue;
    });

    const sql = 'SELECT * FROM users WHERE id = 1';
    const sourceUri = 'file:///path/to/script.sql';
    const count = 5;

    // Expect first 30 chars with ellipsis
    const expected = 'SELECT * FROM users WHERE id =...';
    const title = generateTabTitle(sql, sourceUri, count);
    assert.strictEqual(title, expected);
  });

  it('should clean whitespace in query snippets', () => {
    mockWorkspaceConfig.get.mockImplementation((key: string, defaultValue: any) => {
      if (key === 'tabNaming') {
        return 'query-snippet';
      }
      return defaultValue;
    });

    const sql = `SELECT *
    FROM users
    WHERE id = 1`;
    const title = generateTabTitle(sql, undefined, 1);
    // Should clean newlines and extra spaces
    assert.strictEqual(title, 'SELECT * FROM users WHERE id =...');
  });

  it('should handle short query snippets without ellipsis', () => {
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

  it('should fallback to Result if no sourceUri in sequential mode', () => {
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
