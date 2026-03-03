/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testRegex: '/__tests__/.*\\.test\\.ts$',
    moduleNameMapper: {
        '@sql-preview/connector-api': '<rootDir>/../../packages/sql-preview-connector-api/src/index.ts',
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    moduleFileExtensions: ['ts', 'js', 'json'],
    testTimeout: 30000,
};
