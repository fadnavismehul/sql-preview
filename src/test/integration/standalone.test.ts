import * as cp from 'child_process';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';

// Ensure we use real FS for integration test
jest.unmock('fs');
jest.unmock('child_process');
jest.unmock('path');

const STANDALONE_PATH = path.resolve(__dirname, '../../../out/server/standalone.js');
const TEST_PORT = 8500 + Math.floor(Math.random() * 1000);

describe('Standalone Daemon Integration', () => {
  let daemonProcess: cp.ChildProcess;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-preview-standalone-test-'));
  });

  afterEach(() => {
    if (daemonProcess) {
      daemonProcess.kill();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should start and respond to status check', async () => {
    // Start the process
    console.log(`Spawning daemon on port ${TEST_PORT}...`);
    daemonProcess = cp.spawn('node', [STANDALONE_PATH, '--port', TEST_PORT.toString()], {
      stdio: 'pipe',
      env: { ...process.env, SQL_PREVIEW_LOG_LEVEL: 'DEBUG', SQL_PREVIEW_HOME: tempDir },
    });

    // Wait for "Daemon HTTP listening"
    await new Promise<void>((resolve, reject) => {
      let output = '';
      daemonProcess.stdout?.on('data', data => {
        output += data.toString();
        // Check for specific startup message from Daemon.ts
        if (output.includes('Daemon HTTP listening')) {
          resolve();
        }
      });
      daemonProcess.stderr?.on('data', data => {
        console.error('Daemon Stderr:', data.toString());
      });
      daemonProcess.on('error', reject);
      daemonProcess.on('exit', code => {
        if (code !== 0 && code !== null) {
          reject(new Error(`Daemon exited with code ${code}. Output: ${output}`));
        }
      });

      // Timeout
      setTimeout(
        () => reject(new Error(`Timeout waiting for daemon start. Output so far: ${output}`)),
        10000
      );
    });

    // Make request
    const response = await new Promise<any>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${TEST_PORT}/status`, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
    });

    expect(response.status).toBe('running');
    expect(response.service).toContain('sql-preview-daemon');
    expect(response.pid).toBeDefined();
  });
});
