#!/usr/bin/env node
/**
 * Validate CHANGELOG.md has an entry for the release version.
 *
 * Used by CI and pre-push hook to ensure changelog is updated before release.
 *
 * Usage:
 *   node scripts/check-changelog.js <version>
 *   node scripts/check-changelog.js 0.1.27
 *
 * Exit codes:
 *   0 - Changelog has entry for version
 *   1 - Missing changelog entry or other error
 */

const fs = require('fs');
const path = require('path');

function checkChangelog(version) {
  // Normalize version (remove leading 'v' if present)
  version = version.replace(/^v/, '');

  // Try both 'CHANGELOG.md' and 'Changelog.md'
  let changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) {
    changelogPath = path.join(__dirname, '..', 'Changelog.md');
    if (!fs.existsSync(changelogPath)) {
      console.error(`ERROR: CHANGELOG.md not found at ${changelogPath}`);
      return false;
    }
  }

  const content = fs.readFileSync(changelogPath, 'utf-8');

  // Look for version header like "## [0.1.27]"
  const pattern = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm');
  if (pattern.test(content)) {
    console.log(`✓ CHANGELOG.md has entry for version ${version}`);
    return true;
  }

  console.error(`ERROR: CHANGELOG.md missing entry for version ${version}`);
  console.error('');
  console.error('Please add a changelog entry before releasing:');
  console.error(`  ## [${version}] - YYYY-MM-DD`);
  console.error('  - Description of changes');
  console.error('');
  console.error('See CHANGELOG.md for format examples.');
  return false;
}

function main() {
  if (process.argv.length !== 3) {
    console.error(`Usage: ${process.argv[1]} <version>`);
    console.error(`Example: ${process.argv[1]} 0.1.27`);
    process.exit(1);
  }

  const version = process.argv[2];
  const success = checkChangelog(version);
  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { checkChangelog };
