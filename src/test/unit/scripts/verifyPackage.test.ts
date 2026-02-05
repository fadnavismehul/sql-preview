const mockExecSync = jest.fn();
jest.mock('child_process', () => ({
  execSync: mockExecSync,
}));

describe('Verification Script (Regression)', () => {
  let checkPackageContent: any;
  let consoleErrorStub: jest.SpyInstance;
  let consoleLogStub: jest.SpyInstance;
  let processExitStub: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    mockExecSync.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    consoleErrorStub = jest.spyOn(console, 'error').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    consoleLogStub = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Mock process.exit to throw so we can catch it
    processExitStub = jest.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`Process exit ${code}`);
    });

    // Path fix: ../../../../../scripts vs ../../../../scripts
    // File is at src/test/unit/scripts/verifyPackage.test.ts
    // scripts is at ./scripts (from root)
    // src is at ./src
    // So we need to go up: scripts (1), unit (2), test (3), src (4) -> Root = 5 levels?
    // Let's verify:
    // ../ (unit), ../../ (test), ../../../ (src), ../../../../ (root).
    // So ../../../../scripts is correct if we are in src/test/unit/scripts.

    // Path fix: ../../../../scripts
    // File is at src/test/unit/scripts/verifyPackage.test.ts
    // scripts is at ./scripts (from root)

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const scriptModule = require('../../../../scripts/verify-package-content');
    checkPackageContent = scriptModule.checkPackageContent;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should pass with valid file list', () => {
    (mockExecSync as jest.Mock).mockReturnValue(
      ['package.json', 'out/extension.js', 'README.md'].join('\n')
    );

    try {
      checkPackageContent();
    } catch (e) {
      // Should not throw
    }

    expect(processExitStub).not.toHaveBeenCalled();
    expect(consoleLogStub).toHaveBeenCalledWith(
      expect.stringMatching(/✅ Package verification passed!/)
    );
  });

  it('should fail when sensitive files are included (.env)', () => {
    mockExecSync.mockReturnValue(['package.json', '.env', 'out/extension.js'].join('\n'));

    try {
      checkPackageContent();
    } catch (e) {
      expect((e as Error).message).toBe('Process exit 1');
    }

    expect(processExitStub).toHaveBeenCalledWith(1);
    expect(consoleErrorStub).toHaveBeenCalledWith(
      expect.stringMatching(/Forbidden file included: .env/)
    );
  });

  it('should fail when sensitive files are included (.env.local)', () => {
    mockExecSync.mockReturnValue(['package.json', '.env.local', 'out/extension.js'].join('\n'));

    try {
      checkPackageContent();
    } catch (e) {
      expect((e as Error).message).toBe('Process exit 1');
    }

    expect(processExitStub).toHaveBeenCalledWith(1);
    expect(consoleErrorStub).toHaveBeenCalledWith(
      expect.stringMatching(/Forbidden file included: .env.local/)
    );
  });

  it('should fail when node_modules are included excessively', () => {
    const files = ['package.json'];
    for (let i = 0; i < 60; i++) {
      files.push(`node_modules/pkg/${i}.js`);
    }
    mockExecSync.mockReturnValue(files.join('\n'));

    try {
      checkPackageContent();
    } catch (e) {
      expect((e as Error).message).toBe('Process exit 1');
    }

    expect(processExitStub).toHaveBeenCalledWith(1);
    expect(consoleErrorStub).toHaveBeenCalledWith(
      expect.stringMatching(/Too many node_modules files included/)
    );
  });

  it('should pass when node_modules are within limit (e.g. sqlite3)', () => {
    const files = ['package.json'];
    // Simulate just sqlite3 being included (e.g. 10 files)
    for (let i = 0; i < 10; i++) {
      files.push(`node_modules/sqlite3/${i}.js`);
    }
    mockExecSync.mockReturnValue(files.join('\n'));

    try {
      checkPackageContent();
    } catch (e) {
      // Should not throw
    }

    expect(processExitStub).not.toHaveBeenCalled();
  });
});
