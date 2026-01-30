/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as vscode from 'vscode';
import { PrestoCodeLensProvider } from '../../PrestoCodeLensProvider';

// Mocks are handled in setup.ts

describe('PrestoCodeLensProvider', () => {
  let provider: PrestoCodeLensProvider;
  let mockDocument: any;

  beforeEach(() => {
    provider = new PrestoCodeLensProvider();
    mockDocument = {
      getText: jest.fn(),
      positionAt: jest.fn(offset => new vscode.Position(0, offset)),
      lineAt: jest.fn().mockReturnValue({
        isEmptyOrWhitespace: false,
        firstNonWhitespaceCharacterIndex: 0,
      }),
    };
  });

  it('should provide CodeLenses for valid SQL statements', () => {
    const sql = 'SELECT 1; SELECT 2';
    mockDocument.getText.mockReturnValue(sql);
    // Mock positionAt to return somewhat realistic positions
    mockDocument.positionAt.mockImplementation((offset: number) => {
      // Simplified logic: 10 chars per line for testing
      return new vscode.Position(Math.floor(offset / 10), offset % 10);
    });

    // Mock lineAt to handle different lines
    mockDocument.lineAt.mockImplementation((line: number) => ({
      isEmptyOrWhitespace: false,
      firstNonWhitespaceCharacterIndex: 0,
      lineNumber: line,
    }));

    const lenses = provider.provideCodeLenses(
      mockDocument as vscode.TextDocument
    ) as vscode.CodeLens[];

    // Expect 2 lenses per query * 2 queries = 4 lenses
    expect(lenses).toHaveLength(4);

    // Verify Commands
    expect(lenses[0]!.command!.title).toBe('▶️ Run');
    expect(lenses[0]!.command!.arguments).toEqual(['SELECT 1']);

    expect(lenses[1]!.command!.title).toBe('▶️➕ Run (+ Tab)');
    expect(lenses[1]!.command!.arguments).toEqual(['SELECT 1']);

    expect(lenses[2]!.command!.title).toBe('▶️ Run');
    expect(lenses[2]!.command!.arguments).toEqual(['SELECT 2']);
  });

  it('should ignore empty statements', () => {
    mockDocument.getText.mockReturnValue(';;;   ; ');
    const lenses = provider.provideCodeLenses(
      mockDocument as vscode.TextDocument
    ) as vscode.CodeLens[];
    expect(lenses).toHaveLength(0);
  });

  it('should handle single statement', () => {
    mockDocument.getText.mockReturnValue('SELECT * FROM table');
    const lenses = provider.provideCodeLenses(
      mockDocument as vscode.TextDocument
    ) as vscode.CodeLens[];
    expect(lenses).toHaveLength(2);
    expect(lenses[0]!.command!.arguments).toEqual(['SELECT * FROM table']);
  });
});
