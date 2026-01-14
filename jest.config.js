module.exports = {
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.[jt]sx?$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironment: 'node',
  setupFiles: ['./src/test/setup.ts'],
  moduleNameMapper: {
    '^vscode$': '@vscode/test-electron',
  },
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: true,
  testPathIgnorePatterns: [
    '/node_modules/',
    '/out/', // Ignore compiled JavaScript files
    '.*\\.integration\\.test\\.ts$', // Ignore integration tests which require real VS Code
  ],
};
