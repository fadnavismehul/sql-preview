import * as path from 'path';
import * as os from 'os';
// import * as cp from 'child_process'; // Currently unused
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to the extension test runner script
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Download VS Code, unzip it and run the integration test
    const vscodeExecutablePath = await downloadAndUnzipVSCode({
      version: '1.96.0',
      cachePath: path.resolve(process.env['HOME'] || os.homedir(), '.vscode-test-cache'),
    });
    const [, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

    // Run the integration tests
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: args,
    });
  } catch (err) {
    // console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
