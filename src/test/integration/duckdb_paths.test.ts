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
const TEST_PORT = 8700 + Math.floor(Math.random() * 1000);

describe('DuckDB Path Integration', () => {
  let daemonProcess: cp.ChildProcess;
  let tempDir: string;
  let csvPath: string;

  beforeAll(() => {
    // Create temp dir and CSV
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-preview-path-test-'));
    csvPath = path.join(tempDir, 'data.csv'); // Use standard name
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob');
  });

  afterAll(() => {
    if (fs.existsSync(csvPath)) {
      fs.unlinkSync(csvPath);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (daemonProcess) {
      daemonProcess.kill();
    }
  });

  it('should auto-route query with ./ prefix', async () => {
    console.log(`Spawning daemon in ${tempDir} on port ${TEST_PORT}...`);
    daemonProcess = cp.spawn('node', [STANDALONE_PATH, '--port', TEST_PORT.toString()], {
      cwd: tempDir,
      stdio: 'pipe',
      env: { ...process.env, SQL_PREVIEW_LOG_LEVEL: 'DEBUG', SQL_PREVIEW_HOME: tempDir },
    });

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

    // Query using ./data.csv with a connectionId (simulating UI selection)
    // This makes sure the daemon IGNORES the connectionId and uses DuckDB because of regex.
    const query = "SELECT * FROM './data.csv'";
    const postData = JSON.stringify({
      query,
      sessionId: 'test-session-path-1',
      connectionId: 'fake-trino-connection', // This would normally fail if used
    });

    await new Promise<void>((resolve, reject) => {
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
            const result = JSON.parse(data);
            if (result.error) {
              console.error('Query Error:', result.error);
              reject(new Error(result.error));
            } else {
              if (result.data.length === 2 && result.data[0][1] === 'Alice') {
                resolve();
              } else {
                reject(new Error('Unexpected data returned'));
              }
            }
          });
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    // Test 2: Tilde path
    // We expect this to ALSO route to DuckDB (regex matches).
    // Even if it fails to find file, it should NOT return "No valid connection profile found".
    // It should return a DuckDB error (or success if we happened to coincide with a real file, unlikely).
    const tildeQuery = "SELECT * FROM '~/data.csv'";
    const tildePostData = JSON.stringify({ query: tildeQuery, sessionId: 'test-session-path-2' });

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path: '/query',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': tildePostData.length,
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            const result = JSON.parse(data);
            // If it routed to DuckDB, result.error should contain "DuckDB" or be a catalog error.
            // If it fell back (and no connections), it says "No valid connection profile found".
            if (result.error && result.error.includes('No valid connection profile found')) {
              reject(new Error('Failed to route tilde path to DuckDB'));
            } else {
              // Pass if it tried DuckDB (even if file not found)
              console.log('Tilde Query Result:', result);
              resolve();
            }
          });
        }
      );
      req.on('error', reject);
      req.write(tildePostData);
      req.end();
    });
    // Test 3: Trailing space inside quotes (Regression Test)
    // Verify that "SELECT * FROM '~/data.csv '" routes to DuckDB and doesn't fall back to Trino.
    const trailingSpaceQuery = "SELECT * FROM './data.csv '";
    const trailingSpacePostData = JSON.stringify({
      query: trailingSpaceQuery,
      sessionId: 'test-session-path-3',
      connectionId: 'fake-trino-connection',
    });

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path: '/query',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': trailingSpacePostData.length,
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            const result = JSON.parse(data);
            if (result.error) {
              // If it routed to DuckDB, it might fail if file not found with space,
              // BUT for './data.csv ' (local file), maybe DuckDB strips it?
              // OR if it fails with "DuckDB" error, it passed routing.
              // If it fails with "No valid connection profile found" (and we have fake connectionId?),
              // actually getting "Auto-Routing Failed" is the key success metric if it TRIES DuckDB.
              // But here we want it to SUCCESS because we point to real file ./data.csv
              // DO we expect DuckDB to handle 'data.csv '?
              // If DuckDB fails to find 'data.csv ', that's fine, as long as it TRIED DuckDB.
              // We just want to ensure it didn't use 'fake-trino-connection' which would return...
              // Wait, 'fake-trino-connection' returns "Connector 'duckdb' not registered"? No.
              // The fake connectionId will try to load a profile. The profile loading will fail if ID invalid.
              // If routing works, it uses ADHOC profile.
              // So if we get a result (even error) from DuckDB, we win.
              // If we get "Profile not found" or Trino error, we fail.

              // Actually, DuckDB might treats 'data.csv ' as the filename.
              // If the file on disk is 'data.csv', then 'data.csv ' won't be found.
              // Does the regex fix STRIP the space? NO. It just MATCHES.
              // So DuckDB receives 'data.csv '.
              // So DuckDB will say "File not found".
              // This confirms routing worked! (Because otherwise it would fall back to connectionId).

              if (result.error.includes('Auto-Routing Failed') || result.error.includes('DuckDB')) {
                resolve();
              } else {
                reject(new Error(`Regression: routing failed, got error: ${result.error}`));
              }
            } else {
              // If it somehow worked (DuckDB ignores space?), that's also fine.
              resolve();
            }
          });
        }
      );
      req.on('error', reject);
      req.write(trailingSpacePostData);
      req.end();
    });
    // Test 4: Comment between FROM and file path (Regression Test)
    // Verify that "SELECT * FROM -- comment \n './data.csv'" routes to DuckDB.
    const commentQuery = "SELECT * FROM -- comment \n './data.csv'";
    const commentPostData = JSON.stringify({
      query: commentQuery,
      sessionId: 'test-session-path-4',
      connectionId: 'fake-trino-connection',
    });

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path: '/query',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': commentPostData.length,
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            const result = JSON.parse(data);
            if (result.error) {
              // Similar success criteria as above: if it tried DuckDB, we win.
              if (result.error.includes('Auto-Routing Failed') || result.error.includes('DuckDB')) {
                resolve();
              } else {
                reject(
                  new Error(
                    `Regression: routing failed for comment query, got error: ${result.error}`
                  )
                );
              }
            } else {
              resolve();
            }
          });
        }
      );
      req.on('error', reject);
      req.write(commentPostData);
      req.end();
    });
  });
});
