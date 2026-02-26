import * as fs from 'fs';
import * as path from 'path';

export class DriverManager {
  /**
   * Resolves the executable path for a connector.
   */
  public async getConnectorExecutablePath(
    connectorType: string,
    customPath?: string
  ): Promise<string> {
    if (customPath) {
      if (path.isAbsolute(customPath) && fs.existsSync(customPath)) {
        return customPath;
      }
      throw new Error(`Custom connector executable not found at path: ${customPath}`);
    }

    // Default built-in resolution (assuming they are bundled alongside the daemon)
    // For now, in dev mode, we can point to the packages folder
    let executableName = '';
    if (connectorType === 'duckdb') {
      executableName = 'sql-preview-duckdb';
    }
    if (connectorType === 'sqlite') {
      executableName = 'sql-preview-sqlite';
    }
    if (connectorType === 'postgres') {
      executableName = 'sql-preview-postgres';
    }

    if (!executableName) {
      throw new Error(`Unknown built-in connector type: ${connectorType}`);
    }

    // Try to find it in the current directory tree (for dev/testing)
    const possiblePaths = [
      path.join(__dirname, '..', '..', 'packages', executableName, 'dist', 'cli.js'),
      path.join(__dirname, '..', '..', '..', 'packages', executableName, 'dist', 'cli.js'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    throw new Error(`Could not locate built-in executable for ${connectorType}`);
  }
}
