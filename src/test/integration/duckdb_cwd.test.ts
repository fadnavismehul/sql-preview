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
const TEST_PORT = 8600 + Math.floor(Math.random() * 1000);

describe('DuckDB CWD Integration', () => {
  let daemonProcess: cp.ChildProcess;
  let tempDir: string;
  let csvPath: string;

  beforeAll(() => {
    // Create temp dir and CSV
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-preview-test-'));
    csvPath = path.join(tempDir, 'data.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob');
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(csvPath)) {
      fs.unlinkSync(csvPath);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir);
    }
  });

  afterEach(() => {
    if (daemonProcess) {
      daemonProcess.kill();
    }
  });

  it('should query CSV file relative to CWD', async () => {
    // Start the process with CWD = tempDir
    console.log(`Spawning daemon in ${tempDir} on port ${TEST_PORT}...`);
    daemonProcess = cp.spawn('node', [STANDALONE_PATH, '--port', TEST_PORT.toString()], {
      cwd: tempDir, // CRITICAL: Set CWD to temp dir
      stdio: 'pipe',
      env: { ...process.env, SQL_PREVIEW_LOG_LEVEL: 'DEBUG' },
    });

    // Wait for "Daemon HTTP listening"
    await new Promise<void>((resolve, reject) => {
      let output = '';
      daemonProcess.stdout?.on('data', data => {
        output += data.toString();
        if (output.includes('Daemon HTTP listening')) {
          resolve();
        }
      });
      daemonProcess.stderr?.on('data', data => console.error('Stderr:', data.toString()));
      daemonProcess.on('error', reject);

      setTimeout(() => reject(new Error('Timeout waiting for daemon')), 10000);
    });

    // Execute Query via HTTP
    const query = "SELECT * FROM 'data.csv'"; // Relative path
    const postData = JSON.stringify({ query });

    const response = await new Promise<any>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path: '/query',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': postData.length,
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              console.error('Failed to parse response:', data);
              reject(new Error(`Failed to parse JSON: ${e} \nData: ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    // Assertions
    console.log('Server Response:', JSON.stringify(response, null, 2));
    expect(response.columns).toBeDefined();
    expect(response.columns.map((c: any) => c.name)).toEqual(['id', 'name']);
    expect(response.data).toHaveLength(2);
    expect(response.data[0]).toEqual([1, 'Alice']); // DuckDB auto-detects types
  });
});
