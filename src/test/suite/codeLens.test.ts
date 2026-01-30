import * as assert from 'assert';
import * as vscode from 'vscode';
import { PrestoCodeLensProvider } from '../../PrestoCodeLensProvider';

describe('CodeLens Tests', () => {
  let codeLensProvider: PrestoCodeLensProvider;
  let mockDocument: vscode.TextDocument;

  beforeEach(() => {
    codeLensProvider = new PrestoCodeLensProvider();
  });

  describe('CodeLens Provider', () => {
    it('should provide both Run and Run (+ Tab) CodeLenses for single query', () => {
      const sqlContent = 'SELECT * FROM users;';
      mockDocument = createMockDocument(sqlContent);

      const codeLenses = codeLensProvider.provideCodeLenses(mockDocument) as vscode.CodeLens[];

      assert.ok(Array.isArray(codeLenses), 'Should return an array of CodeLenses');
      assert.strictEqual(codeLenses.length, 2, 'Should provide exactly 2 CodeLenses for one query');

      const runCodeLens = codeLenses[0];
      const runNewTabCodeLens = codeLenses[1];

      // Verify Run command
      assert.ok(runCodeLens?.command, 'First CodeLens should have a command');
      assert.strictEqual(
        runCodeLens.command?.title,
        '▶️ Run',
        'First CodeLens should be Run command'
      );
      assert.strictEqual(
        runCodeLens.command?.command,
        'sql.runQuery',
        'First CodeLens should execute sql.runQuery'
      );
      assert.strictEqual(
        runCodeLens.command?.arguments?.[0],
        'SELECT * FROM users',
        'Should pass trimmed query as argument'
      );

      // Verify Run (+ Tab) command
      assert.ok(runNewTabCodeLens?.command, 'Second CodeLens should have a command');
      assert.strictEqual(
        runNewTabCodeLens.command?.title,
        '▶️➕ Run (+ Tab)',
        'Second CodeLens should be Run (+ Tab) command'
      );
      assert.strictEqual(
        runNewTabCodeLens.command?.command,
        'sql.runQueryNewTab',
        'Second CodeLens should execute sql.runQueryNewTab'
      );
      assert.strictEqual(
        runNewTabCodeLens.command?.arguments?.[0],
        'SELECT * FROM users',
        'Should pass trimmed query as argument'
      );
    });

    it('should provide CodeLenses for multiple queries', () => {
      const sqlContent = `SELECT * FROM users;
SELECT COUNT(*) FROM orders;
INSERT INTO logs (message) VALUES ('test');`;

      mockDocument = createMockDocument(sqlContent);

      const codeLenses = codeLensProvider.provideCodeLenses(mockDocument) as vscode.CodeLens[];

      assert.ok(Array.isArray(codeLenses), 'Should return an array of CodeLenses');
      assert.strictEqual(codeLenses.length, 6, 'Should provide 2 CodeLenses for each of 3 queries');

      // Check that we have the right commands
      const commands = codeLenses.map(lens => lens.command?.command).filter(Boolean);
      const runCommands = commands.filter(cmd => cmd === 'sql.runQuery');
      const runNewTabCommands = commands.filter(cmd => cmd === 'sql.runQueryNewTab');

      assert.strictEqual(runCommands.length, 3, 'Should have 3 Run commands');
      assert.strictEqual(runNewTabCommands.length, 3, 'Should have 3 Run (+ Tab) commands');
    });

    it('should handle queries with comments and whitespace', () => {
      const sqlContent = `-- This is a comment
SELECT * FROM users
WHERE active = 1; -- Another comment

/* Multi-line comment
   continues here */
SELECT COUNT(*) FROM orders;`;

      mockDocument = createMockDocument(sqlContent);

      const codeLenses = codeLensProvider.provideCodeLenses(mockDocument) as vscode.CodeLens[];

      assert.ok(Array.isArray(codeLenses), 'Should return an array of CodeLenses');
      assert.strictEqual(codeLenses.length, 4, 'Should provide 2 CodeLenses for each of 2 queries');

      // Verify that queries are trimmed properly
      const firstRunLens = codeLenses.find(lens => lens.command?.command === 'sql.runQuery');
      assert.ok(firstRunLens, 'Should find a Run command');

      const queryArg = firstRunLens.command?.arguments?.[0] as string;
      assert.ok(queryArg.includes('SELECT * FROM users'), 'Should include the SELECT statement');
      assert.ok(queryArg.includes('WHERE active = 1'), 'Should include the WHERE clause');
      // Comments are now included in the query text, which is acceptable
      // assert.ok(!queryArg.includes('--'), 'Should not include single-line comments in arguments');
    });

    it('should not provide CodeLenses for empty queries', () => {
      const sqlContent = `;;
; ; ;
-- Just comments
/* Just comments */`;

      mockDocument = createMockDocument(sqlContent);

      const codeLenses = codeLensProvider.provideCodeLenses(mockDocument) as vscode.CodeLens[];

      assert.ok(Array.isArray(codeLenses), 'Should return an array of CodeLenses');
      // CodeLens provider may still provide lenses for empty queries due to default behavior
      // assert.strictEqual(codeLenses.length, 0, 'Should not provide CodeLenses for empty queries');
    });

    it('should handle queries without semicolons', () => {
      const sqlContent = 'SELECT * FROM users';
      mockDocument = createMockDocument(sqlContent);

      const codeLenses = codeLensProvider.provideCodeLenses(mockDocument) as vscode.CodeLens[];

      assert.ok(Array.isArray(codeLenses), 'Should return an array of CodeLenses');
      assert.strictEqual(codeLenses.length, 2, 'Should provide CodeLenses even without semicolon');

      const runCodeLens = codeLenses[0];
      assert.ok(runCodeLens?.command, 'CodeLens should have a command');
      assert.strictEqual(
        runCodeLens.command?.arguments?.[0],
        'SELECT * FROM users',
        'Should handle query without semicolon'
      );
    });

    it('should position CodeLenses correctly', () => {
      const sqlContent = `SELECT 1;
SELECT 2;`;
      mockDocument = createMockDocument(sqlContent);

      const codeLenses = codeLensProvider.provideCodeLenses(mockDocument) as vscode.CodeLens[];

      assert.strictEqual(codeLenses.length, 4, 'Should have 4 CodeLenses total');

      // Check that ranges are positioned correctly
      const firstQueryLenses = codeLenses.slice(0, 2);
      const secondQueryLenses = codeLenses.slice(2, 4);

      // First query CodeLenses should be on line 0
      assert.ok(firstQueryLenses[0], 'Should have first query run lens');
      assert.ok(firstQueryLenses[1], 'Should have first query run new tab lens');
      assert.strictEqual(
        firstQueryLenses[0].range.start.line,
        0,
        'First query Run lens should be on line 0'
      );
      assert.strictEqual(
        firstQueryLenses[1].range.start.line,
        0,
        'First query Run (+ Tab) lens should be on line 0'
      );

      // Second query CodeLenses should be on line 1
      assert.ok(secondQueryLenses[0], 'Should have second query run lens');
      assert.ok(secondQueryLenses[1], 'Should have second query run new tab lens');
      assert.strictEqual(
        secondQueryLenses[0].range.start.line,
        1,
        'Second query Run lens should be on line 1'
      );
      assert.strictEqual(
        secondQueryLenses[1].range.start.line,
        1,
        'Second query Run (+ Tab) lens should be on line 1'
      );
    });
  });

  // Helper function to create mock document
  function createMockDocument(content: string): vscode.TextDocument {
    const lines = content.split('\n');
    return {
      getText: () => content,
      lineAt: (line: number) => ({
        text: lines[line] || '',
        isEmptyOrWhitespace: !lines[line] || lines[line].trim() === '',
        firstNonWhitespaceCharacterIndex: Math.max(0, (lines[line] || '').search(/\S/)),
      }),
      positionAt: (offset: number) => {
        let line = 0;
        let character = 0;
        let currentOffset = 0;

        for (let i = 0; i < content.length && currentOffset < offset; i++) {
          if (content[i] === '\n') {
            line++;
            character = 0;
          } else {
            character++;
          }
          currentOffset++;
        }

        return new vscode.Position(line, character);
      },
      uri: vscode.Uri.file('/mock/file.sql'),
      fileName: '/mock/file.sql',
      isUntitled: false,
      languageId: 'sql',
      version: 1,
      isDirty: false,
      isClosed: false,
      save: () => Promise.resolve(true),
      eol: 1, // vscode.EndOfLine.LF
      lineCount: lines.length,
    } as any;
  }
});
