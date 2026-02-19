import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { Logger } from '../core/logging/Logger';

export class DriverManager {
  private readonly storagePath: string;

  constructor(context: vscode.ExtensionContext) {
    this.storagePath = context.globalStorageUri.fsPath;
  }

  /**
   * Ensures the driver is installed and returns the path to require it.
   */
  public async getDriver(packageName: string): Promise<string> {
    const driverPath = path.join(this.storagePath, 'node_modules', packageName);

    if (this.isDriverInstalled(driverPath)) {
      return driverPath;
    }

    // Ask for permission
    const selection = await vscode.window.showInformationMessage(
      `The '${packageName}' driver is required to connect to this database. Do you want to download and install it now?`,
      'Install',
      'Cancel'
    );

    if (selection !== 'Install') {
      throw new Error(`Driver '${packageName}' is required but was not installed.`);
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

    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Installing ${packageName} driver...`,
        cancellable: false,
      },
      async () => {
        return new Promise<void>((resolve, reject) => {
          Logger.getInstance().info(`Installing driver: ${packageName} in ${this.storagePath}`);

          const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

          const child = cp.spawn(npmCommand, ['install', packageName, '--no-save'], {
            cwd: this.storagePath,
            env: process.env, // Pass current env to ensure path to node/npm is found
          });

          child.on('error', err => {
            Logger.getInstance().error(`Failed to start npm: ${err.message}`);
            reject(
              new Error(
                `Failed to start npm. Please ensure Node.js and npm are installed. Error: ${err.message}`
              )
            );
          });

          child.on('close', code => {
            if (code === 0) {
              Logger.getInstance().info(`Successfully installed ${packageName}`);
              resolve();
            } else {
              Logger.getInstance().error(`npm install failed with code ${code}`);
              reject(
                new Error(
                  `Failed to install driver '${packageName}'. Exit code: ${code}. Check logs for details.`
                )
              );
            }
          });
        });
      }
    );
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
