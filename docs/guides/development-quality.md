# Quality Tooling & Development Workflow

This document outlines the comprehensive quality assurance setup for the SQL Preview VS Code extension.

## 🎯 Overview

We've implemented a robust quality tooling system that ensures code quality, prevents regressions, and maintains consistency across the codebase. This setup is similar to Python's `ruff` but tailored for TypeScript/JavaScript development.

## 🛠 Tools & Configuration

### 1. ESLint - Code Linting

- **Purpose**: Static code analysis to catch bugs, enforce coding standards
- **Configuration**: `.eslintrc.json`
- **Features**:
  - TypeScript-specific rules
  - Async/await best practices
  - Code complexity limits
  - Unused variable detection
  - Type-aware linting

### 2. Prettier - Code Formatting

- **Purpose**: Automatic code formatting for consistency
- **Configuration**: `.prettierrc`
- **Features**:
  - Single quotes, semicolons, 100-char line width
  - Trailing commas, arrow function parens
  - Consistent indentation

### 3. TypeScript - Strict Type Checking

- **Purpose**: Enhanced type safety and early error detection
- **Configuration**: `tsconfig.json`
- **Features**:
  - Strict mode enabled
  - No implicit any, returns, or this
  - Unused locals/parameters detection
  - Exact optional property types

### 4. Husky - Git Hooks

- **Purpose**: Run quality checks before commits/pushes
- **Configuration**: `.husky/` directory
- **Hooks**:
  - `pre-commit`: Runs lint-staged
  - `pre-push`: Runs full quality check + tests

### 5. lint-staged - Staged Files Processing

- **Purpose**: Run tools only on staged files for performance
- **Configuration**: `package.json` lint-staged section
- **Actions**: ESLint fix, Prettier format, git add

### 6. GitHub Actions - CI/CD

- **Purpose**: Automated quality checks on every PR/push
- **Configuration**: `.github/workflows/ci.yml`
- **Jobs**: Quality checks, tests, build verification

## 📋 Available Scripts

### Quality Assurance

```bash
# Run all quality checks (type-check + lint + format check)
npm run quality-check

# Fix all auto-fixable issues (lint + format)
npm run quality-fix

# Individual checks
npm run type-check    # TypeScript compilation check
npm run lint          # ESLint check
npm run lint:fix      # ESLint with auto-fix
npm run format        # Format code with Prettier
npm run format:check  # Check if code is formatted
```

### Testing

```bash
npm run test              # Run unit tests
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Run tests with coverage
npm run test:integration  # Run VS Code integration tests
npm run test:all          # Run all tests
```

### Build & Package

```bash
npm run build      # Production build
npm run build-dev  # Development build with sourcemaps
npm run package    # Create .vsix package
```

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Initialize Git Hooks

```bash
npm run prepare
```

### 3. Run Quality Check

```bash
npm run quality-check
```

## 🔧 Development Workflow

### Before Committing

The pre-commit hook automatically:

1. Lints and fixes staged TypeScript files
2. Formats staged files with Prettier
3. Re-stages the fixed files

### Before Pushing

The pre-push hook runs:

1. Full type checking
2. Complete linting
3. Format verification
4. All unit tests

### During Development

- Use `npm run test:watch` for continuous testing
- Use `npm run quality-fix` to fix formatting/linting issues
- Use `npm run type-check` to catch type errors early

## 🚫 Quality Gates

### Commit Prevention

Commits are blocked if:

- TypeScript compilation fails
- ESLint finds errors (not warnings)
- Tests fail

### Push Prevention

Pushes are blocked if:

- Type checking fails
- Linting fails
- Tests fail
- Code is not properly formatted

### CI/CD Checks

PRs are blocked if:

- Any quality check fails
- Tests don't pass
- Build fails
- Integration tests fail

## 📊 Code Coverage

- Minimum coverage threshold: 80%
- Coverage reports in `coverage/` directory
- Coverage uploaded to Codecov in CI
- Run `npm run test:coverage` to generate reports

## 🎨 Editor Integration

### VS Code

Recommended extensions:

- ESLint
- Prettier - Code formatter
- TypeScript Importer

Settings in `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

## 🐛 Troubleshooting

### ESLint Issues

```bash
# Fix auto-fixable issues
npm run lint:fix

# Check specific files
npx eslint src/extension.ts --fix
```

### Prettier Issues

```bash
# Format all files
npm run format

# Check specific files
npx prettier --write src/extension.ts
```

### TypeScript Issues

```bash
# Full type check
npm run type-check

# Compile with detailed errors
npx tsc --noEmit --pretty
```

### Git Hook Issues

```bash
# Reinstall hooks
rm -rf .husky/_
npm run prepare

# Skip hooks (emergency only)
git commit --no-verify
```

## 📈 Metrics & Monitoring

- **Code Quality**: ESLint rules enforce complexity limits
- **Test Coverage**: Jest reports line/branch coverage
- **Type Safety**: TypeScript strict mode catches type issues
- **Consistency**: Prettier ensures uniform formatting
- **CI/CD**: GitHub Actions provides build health

This comprehensive setup ensures that your SQL Preview extension maintains high quality standards and prevents regressions during development.
