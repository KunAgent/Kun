#!/bin/bash
set -euo pipefail

BUILD_DIR="$1"
SOURCE_DIR="$2"

# Copy with symlinks resolved
cp -rL "$SOURCE_DIR"/* "$BUILD_DIR"/

# Strip comments and docstrings from Python files
REPO_ROOT="$(cd "$(dirname "$0")/../../../" && pwd)"
find "$BUILD_DIR" -name "*.py" -exec python3 "$REPO_ROOT/utils/strip_comments.py" {} \;
