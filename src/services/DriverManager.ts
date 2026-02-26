import type * as vscodeType from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
let vscode: typeof vscodeType | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscode = require('vscode');
} catch (e) {
  // Headless mode
}

export class DriverManager {
  private readonly storagePath: string;

  constructor(
    contextOrStoragePath: vscodeType.ExtensionContext | string,
    private readonly logger?: any // ILogger or Console
  ) {
    if (typeof contextOrStoragePath === 'string') {
      this.storagePath = contextOrStoragePath;
    } else {
      this.storagePath = contextOrStoragePath.globalStorageUri.fsPath;
    }
  }

  private logInfo(msg: string) {
    if (this.logger) {
      this.logger.info(msg);
    } else {
      console.log(`[DriverManager] ${msg}`);
    }
  }

  private logError(msg: string) {
    if (this.logger) {
      this.logger.error(msg);
    } else {
      console.error(`[DriverManager] ${msg}`);
    }
  }

  /**
   * Ensures the driver is installed and returns the path to require it.
   * Can accept absolute paths to local packages or npm package names (with or without version tags).
   */
  public async getDriver(packageName: string): Promise<string> {
    if (path.isAbsolute(packageName) && fs.existsSync(packageName)) {
      return packageName;
    }

    // Strip version tag for folder resolution (e.g., 'pg@8.11.0' -> 'pg', '@org/pkg@1.0' -> '@org/pkg')
    let folderName = packageName;
    if (packageName.startsWith('@')) {
      const parts = packageName.split('@');
      if (parts.length > 2) {
        folderName = '@' + parts[1];
      }
    } else {
      folderName = packageName.split('@')[0] || packageName;
    }

    const driverPath = path.join(this.storagePath, 'node_modules', folderName);

    if (this.isDriverInstalled(driverPath)) {
      return driverPath;
    }

    // Check if we are running inside VS Code extension host
    let shouldInstall = true;
    if (typeof vscode !== 'undefined' && vscode.window && vscode.window.showInformationMessage) {
      const selection = await vscode.window.showInformationMessage(
        `The '${packageName}' package is required to connect to this database. Do you want to download and install it now?`,
        'Install',
        'Cancel'
      );
      shouldInstall = selection === 'Install';
    } else {
      this.logInfo(`Headless mode: Auto-installing required package ${packageName}`);
    }

    if (!shouldInstall) {
      throw new Error(`Package '${packageName}' is required but was not installed.`);
    }

    await this.installDriver(packageName);
    return driverPath;
  }

  private isDriverInstalled(driverPath: string): boolean {
    return fs.existsSync(driverPath);
  }

  private async installDriver(packageName: string): Promise<void> {
    // Check if npm is available
    if (!(await this.isNpmAvailable())) {
      throw new Error(
        `Cannot install driver '${packageName}' because 'npm' was not found. Please install Node.js and npm to use this feature.`
      );
    }

    // Ensure storage directory exists
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    // Create a dummy package.json if it doesn't exist to avoid warnings or search up tree
    const packageJsonPath = path.join(this.storagePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      fs.writeFileSync(
        packageJsonPath,
        JSON.stringify({ name: 'sql-preview-drivers', dependencies: {} })
      );
    }

    const installPromise = new Promise<void>((resolve, reject) => {
      this.logInfo(`Installing driver: ${packageName} in ${this.storagePath}`);

      const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

      const child = cp.spawn(npmCommand, ['install', packageName, '--no-save'], {
        cwd: this.storagePath,
        env: process.env, // Pass current env to ensure path to node/npm is found
      });

      child.on('error', err => {
        this.logError(`Failed to start npm: ${err.message}`);
        reject(
          new Error(
            `Failed to start npm. Please ensure Node.js and npm are installed. Error: ${err.message}`
          )
        );
      });

      child.on('close', code => {
        if (code === 0) {
          this.logInfo(`Successfully installed ${packageName}`);
          resolve();
        } else {
          this.logError(`npm install failed with code ${code}`);
          reject(
            new Error(
              `Failed to install driver '${packageName}'. Exit code: ${code}. Check logs for details.`
            )
          );
        }
      });
    });

    // Ensure vscode.window exists before using withProgress
    if (typeof vscode !== 'undefined' && vscode.window && vscode.window.withProgress) {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Installing ${packageName}...`,
          cancellable: false,
        },
        async () => {
          return installPromise;
        }
      );
    } else {
      return await installPromise;
    }
  }

  private async isNpmAvailable(): Promise<boolean> {
    try {
      const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      await new Promise<void>((resolve, reject) => {
        const child = cp.spawn(npmCommand, ['--version'], {
          stdio: 'ignore',
          env: process.env,
        });
        child.on('error', reject);
        child.on('close', code => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error('npm check failed'));
          }
        });
      });
      return true;
    } catch (e) {
      return false;
    }
  }
}
