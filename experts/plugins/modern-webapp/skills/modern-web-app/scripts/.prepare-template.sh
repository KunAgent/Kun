#!/bin/bash
set -e

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_PATH="$SCRIPTS_DIR/template"

cd "$TEMPLATE_PATH"
echo "Installing dependencies..."
npm install

echo ""
echo "Setup complete: $TEMPLATE_PATH"
echo ""
