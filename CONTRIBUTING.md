# Contributing to SQL Preview

Thank you for your interest in contributing to SQL Preview! We welcome contributions from the community.

## Getting Started

1.  **Fork the repository** on GitHub.
2.  **Clone your fork** locally:
    ```bash
    git clone https://github.com/your-username/sql-preview.git
    cd sql-preview
    ```
3.  **Install dependencies**:
    ```bash
    npm install
    ```

## Development

- **Run the extension**: Open the project in VS Code and press `F5`. This will launch a new Extension Development Host window.
- **Linting**: Run `npm run lint` to check for linting issues.
- **Formatting**: Run `npm run format` to format code with Prettier.
- **Testing**: Run `npm test` to run unit tests.

## Project Structure

- `src/`: Source code
  - `core/`: Core domain logic
  - `connectors/`: Database connectors (Trino, etc.)
  - `modules/`: Functional modules (MCP Server)
  - `webviews/`: Frontend assets
- `AGENTS.md`: Instructions for AI agents working on this codebase.

## Submitting Changes

1.  Create a new branch for your feature or bug fix.
2.  Make your changes and ensure tests pass.
3.  Commit your changes with descriptive commit messages.
4.  Push your branch to your fork.
5.  Submit a Pull Request to the main repository.

## License

By contributing, you agree that your contributions will be licensed under the project's license (see `LICENSE` file).
