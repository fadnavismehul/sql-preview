import * as fs from 'fs';
import { DriverManager } from '../../services/DriverManager';
import { Logger } from '../../core/logging/Logger';

// Dependencies are mocked in setup.ts or explicitly here if needed logic differs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

jest.mock('../../core/logging/Logger');

describe('DriverManager', () => {
  let driverManager: DriverManager;
  beforeEach(() => {
    jest.clearAllMocks();

    driverManager = new DriverManager();

    // Mock Logger
    (Logger.getInstance as jest.Mock).mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
    });
  });

  describe('getConnectorExecutablePath', () => {
    it('should return custom absolute path if it exists', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const customPath = '/absolute/path/to/my-connector';
      const result = await driverManager.getConnectorExecutablePath('custom', customPath);

      expect(result).toBe(customPath);
      expect(fs.existsSync).toHaveBeenCalledWith(customPath);
    });

    it('should throw error if custom absolute path does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const customPath = '/absolute/path/to/my-connector';

      await expect(driverManager.getConnectorExecutablePath('custom', customPath)).rejects.toThrow(
        `Custom connector executable not found at path: ${customPath}`
      );
    });

    it('should resolve built-in connector path in dev fallback locations', async () => {
      // Setup the mock such that the second probed path returns true
      (fs.existsSync as jest.Mock).mockImplementation((probePath: string) => {
        return probePath.includes('sql-preview-duckdb');
      });

      const result = await driverManager.getConnectorExecutablePath('duckdb');
      expect(result).toContain('sql-preview-duckdb');
      expect(result).toContain('cli.js');
    });

    it('should throw if built-in connector is unknown', async () => {
      await expect(driverManager.getConnectorExecutablePath('unknown-db')).rejects.toThrow(
        `Unknown built-in connector type: unknown-db`
      );
    });
  });
});
