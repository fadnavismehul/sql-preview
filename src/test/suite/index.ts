import * as path from 'path';
import Mocha from 'mocha';
import * as fs from 'fs';

/* eslint-disable no-console */

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 10000,
  });

  const testsRoot = path.resolve(__dirname, '.');

  // Helper to recursively find test files
  function findTestFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        findTestFiles(filePath, fileList);
      } else {
        // Filter for integration tests primarily as requested
        if (file.endsWith('.test.js')) {
          fileList.push(filePath);
        }
      }
    });
    return fileList;
  }

  console.log(`Searching for integration tests in: ${testsRoot}`);
  const files = findTestFiles(testsRoot);
  console.log(`Found ${files.length} test files.`);

  // Add files to the test suite
  files.forEach(f => {
    console.log(`Adding test file: ${f}`);
    mocha.addFile(f);
  });

  // Run the mocha test
  return new Promise((resolve, reject) => {
    try {
      mocha.run(failures => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
