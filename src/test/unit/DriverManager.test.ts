import * as vscode from 'vscode';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as path from 'path';
import { DriverManager } from '../../services/DriverManager';
import { Logger } from '../../core/logging/Logger';

// Dependencies are mocked in setup.ts or explicitly here if needed logic differs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('../../core/logging/Logger');
jest.mock('child_process');

describe('DriverManager', () => {
  let driverManager: DriverManager;
  let mockContext: vscode.ExtensionContext;
  let mockChildProcess: any;

  const mockStoragePath = '/mock/globalStorage';

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      globalStorageUri: { fsPath: mockStoragePath },
    } as any;

    driverManager = new DriverManager(mockContext);

    // Mock Logger
    (Logger.getInstance as jest.Mock).mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
    });

    // Mock Child Process
    mockChildProcess = {
      on: jest.fn((event, cb) => {
        if (event === 'close') {
          cb(0);
        } // Default success
      }),
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
    };
    (cp.spawn as jest.Mock).mockReturnValue(mockChildProcess);
  });

  describe('getDriver', () => {
    it('should return driver path if already installed', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const driverPath = await driverManager.getDriver('pg');

      expect(driverPath).toContain(path.join(mockStoragePath, 'node_modules', 'pg'));
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('should prompt for installation if not installed', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false); // First check fails
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Install');

      // withProgress mock implementation
      (vscode.window.withProgress as jest.Mock).mockImplementation((_opts, task) => {
        return task();
      });

      await driverManager.getDriver('mysql');

      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
      expect(cp.spawn).toHaveBeenCalledWith(
        expect.stringContaining('npm'),
        ['install', 'mysql', '--no-save'],
        expect.objectContaining({ cwd: mockStoragePath })
      );
    });

    it('should throw if user cancels installation', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Cancel');

      await expect(driverManager.getDriver('mysql')).rejects.toThrow('was not installed');
      expect(cp.spawn).not.toHaveBeenCalled();
    });
  });

  describe('installDriver failure', () => {
    it('should reject if npm install fails', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Install');

      (vscode.window.withProgress as jest.Mock).mockImplementation((_opts, task) => {
        return task();
      });

      // Mock spawn failure
      mockChildProcess.on.mockImplementation((event: string, cb: any) => {
        if (event === 'close') {
          cb(1);
        } // Error code
      });

      await expect(driverManager.getDriver('pg')).rejects.toThrow('Failed to install driver');
    });
  });
});
