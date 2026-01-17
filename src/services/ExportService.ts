import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { QueryExecutor } from './QueryExecutor';
import { TabData } from '../common/types';

export class ExportService {
  constructor(private readonly queryExecutor: QueryExecutor) {}

  public async exportResults(tab: TabData) {
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

          if (format === 'json') {
            stream.write('[\n');
          }

          for await (const page of generator) {
            if (token.isCancellationRequested) {
              break;
            }

            if (page.columns && firstPage && (format === 'csv' || format === 'tsv')) {
              const separator = format === 'csv' ? ',' : '\t';
              const header =
                page.columns.map(c => this._escapeCsv(c.name, separator)).join(separator) + '\n';
              stream.write(header);
              firstPage = false;
            }

            if (page.data) {
              const separator = format === 'csv' ? ',' : '\t';
              for (const row of page.data) {
                if (format === 'json') {
                  const prefix = rowCount > 0 ? ',\n' : '';
                  stream.write(prefix + JSON.stringify(row));
                } else {
                  const line = row.map(v => this._escapeCsv(v, separator)).join(separator) + '\n';
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
        } catch (err: any) {
          vscode.window.showErrorMessage(`Export failed: ${err.message}`);
        } finally {
          stream.end();
        }
      }
    );
  }

  private _escapeCsv(val: any, separator: string): string {
    if (val === null || val === undefined) {
      return '';
    }
    const str = String(val);
    if (str.includes(separator) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
}
