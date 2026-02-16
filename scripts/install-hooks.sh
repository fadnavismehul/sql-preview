#!/bin/bash
# Install git hooks for development
#
# Usage: ./scripts/install-hooks.sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SCRIPTS_HOOKS_DIR="$REPO_ROOT/scripts/hooks"

echo "Installing git hooks..."

# Install pre-push hook
if [ -f "$SCRIPTS_HOOKS_DIR/pre-push" ]; then
    cp "$SCRIPTS_HOOKS_DIR/pre-push" "$HOOKS_DIR/pre-push"
    chmod +x "$HOOKS_DIR/pre-push"
    echo "✓ Installed pre-push hook"
fi

echo ""
echo "Git hooks installed successfully!"
echo "The pre-push hook will validate CHANGELOG.md, linting, types, tests, and build before pushing version tags."
