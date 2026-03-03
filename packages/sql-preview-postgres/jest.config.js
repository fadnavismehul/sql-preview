/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    moduleNameMapper: {
        '^@sql-preview/connector-api$':
            '<rootDir>/../../packages/sql-preview-connector-api/src/index.ts',
        '^../../../src/connectors/base/IConnector$':
            '<rootDir>/../../packages/sql-preview-connector-api/src/index.ts',
        '^../../../src/common/types$':
            '<rootDir>/../../packages/sql-preview-connector-api/src/index.ts',
        '^../../../src/common/errors$':
            '<rootDir>/../../packages/sql-preview-connector-api/src/index.ts',
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
    },
    testPathIgnorePatterns: ['/node_modules/', '/dist/', '\\.integration\\.test\\.ts$'],
    passWithNoTests: true,
};
