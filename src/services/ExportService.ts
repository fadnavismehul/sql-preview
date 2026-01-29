import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { QueryExecutor } from '../core/execution/QueryExecutor';
import { TabData } from '../common/types';

export class ExportService {
  constructor(private readonly queryExecutor: QueryExecutor) {}

  public async exportResults(tab: TabData) {
    // Warn user that export re-executes the query
    const proceed = await vscode.window.showWarningMessage(
      'Export will re-run the query to fetch all results. Data may have changed since the original query.',
      { modal: false },
      'Continue',
      'Cancel'
    );

    if (proceed !== 'Continue') {
      return;
    }

    // Resolve context URI for configuration and workspace folder
    const contextUri = tab.sourceFileUri ? vscode.Uri.parse(tab.sourceFileUri) : undefined;

    // Determine default save folder
    let defaultFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    if (contextUri) {
      const folder = vscode.workspace.getWorkspaceFolder(contextUri);
      if (folder) {
        defaultFolder = folder.uri.fsPath;
      }
    }

    const saveUri = await vscode.window.showSaveDialog({
      filters: {
        'CSV (Comma Separated)': ['csv'],
        'TSV (Tab Separated)': ['tsv'],
        JSON: ['json'],
      },
      title: 'Export Full Results',
      defaultUri: vscode.Uri.file(
        path.join(defaultFolder, `${tab.title.replace(/\s+/g, '_')}.csv`)
      ),
    });

    if (!saveUri) {
      return;
    }

    const format = saveUri.fsPath.endsWith('.tsv')
      ? 'tsv'
      : saveUri.fsPath.endsWith('.json')
        ? 'json'
        : 'csv';

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Exporting results to ${path.basename(saveUri.fsPath)}`,
        cancellable: true,
      },
      async (progress, token) => {
        const stream = fs.createWriteStream(saveUri.fsPath);
        let rowCount = 0;

        try {
          const generator = this.queryExecutor.execute(tab.query, contextUri);
          let firstPage = true;
          let columns: import('../common/types').ColumnDef[] | undefined;

          if (format === 'json') {
            stream.write('[\n');
          }

          for await (const page of generator) {
            if (token.isCancellationRequested) {
              break;
            }

            if (page.columns) {
              columns = page.columns;
            }

            if (columns && firstPage && (format === 'csv' || format === 'tsv')) {
              const separator = format === 'csv' ? ',' : '\t';
              const header =
                columns.map(c => this._escapeCsv(c.name, separator)).join(separator) + '\n';
              stream.write(header);
              firstPage = false;
            } else if (page.columns && firstPage) {
              // Ensure firstPage flag is flipped for other formats if columns arrived
              firstPage = false;
            }

            if (page.data) {
              const separator = format === 'csv' ? ',' : '\t';
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const currentColumns = columns;

              for (const row of page.data) {
                if (format === 'json') {
                  const prefix = rowCount > 0 ? ',\n' : '';
                  let item: unknown = row;
                  if (currentColumns) {
                    const obj: Record<string, unknown> = {};
                    currentColumns.forEach((col, idx) => {
                      // Safety check for row length?
                      // The row should match columns.
                      // row is unknown[] actually, let's cast
                      const vals = row as unknown[];
                      obj[col.name] = vals[idx];
                    });
                    item = obj;
                  }
                  stream.write(prefix + JSON.stringify(item));
                } else {
                  // CSV/TSV
                  // cast row to unknown[]
                  const vals = row as unknown[];
                  const line = vals.map(v => this._escapeCsv(v, separator)).join(separator) + '\n';
                  stream.write(line);
                }
                rowCount++;
              }
            }
            progress.report({ message: `Exported ${rowCount} rows...` });
          }

          if (format === 'json') {
            stream.write('\n]');
          }

          vscode.window
            .showInformationMessage(
              `✅ Export complete: ${rowCount} rows saved.`,
              'Reveal in Finder'
            )
            .then(selection => {
              if (selection === 'Reveal in Finder') {
                vscode.commands.executeCommand('revealFileInOS', saveUri);
              }
            });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Export failed: ${message}`);
        } finally {
          stream.end();
        }
      }
    );
  }

  private _escapeCsv(val: unknown, separator: string): string {
    if (val === null || val === undefined) {
      return '';
    }
    const str = String(val);
    if (new RegExp(`["${separator}\\n\\r]`).test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
}
