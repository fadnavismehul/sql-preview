const { execSync } = require('child_process');
const path = require('path');

// Configuration
const DENY_PATTERNS = [
    /\.env/,
    /secrets\.json/,
    /^\.git/,
    /^src\//, // Source should not be packaged if we are bundling
    /^test\//,
    /^tsconfig\.json/,
    /^webpack\.config\.js/,
    /^\.vscode-test/,
    /^\.DS_Store/
];

const MAX_NODE_MODULES_FILES = 50; // Strict limit to catch accidental bundling

function checkPackageContent() {
    console.log('📦 Verifying package content...');

    try {
        // Run vsce ls to get list of files
        const output = execSync('npx vsce ls', { encoding: 'utf8' });
        const files = output.trim().split('\n').filter(Boolean);

        const errors = [];
        let nodeModulesCount = 0;

        files.forEach(file => {
            // Check deny list
            DENY_PATTERNS.forEach(pattern => {
                if (pattern.test(file)) {
                    errors.push(`❌ Forbidden file included: ${file} (matches ${pattern})`);
                }
            });

            // Count node_modules
            if (file.includes('node_modules/')) {
                nodeModulesCount++;
            }
        });

        // Validate node_modules count
        if (nodeModulesCount > MAX_NODE_MODULES_FILES) {
            errors.push(`❌ Too many node_modules files included: ${nodeModulesCount} (Max: ${MAX_NODE_MODULES_FILES}). ` +
                `Please verify .vscodeignore excludes node_modules.`);
        }

        if (errors.length > 0) {
            console.error('\n🚨 Package Verification Failed:');
            errors.forEach(err => console.error(err));
            console.error('\nPlease update .vscodeignore to exclude these files.');
            process.exit(1);
        }

        console.log(`✅ Package verification passed! (${files.length} files included)`);

    } catch (e) {
        console.error('Failed to run verification:', e.message);
        process.exit(1);
    }
}

if (require.main === module) {
    checkPackageContent();
}

module.exports = { checkPackageContent };
