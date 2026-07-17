#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="$1"
[[ "$OSTYPE" == "darwin"* ]] && SED_INPLACE="sed -i ''" || SED_INPLACE="sed -i"

# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

! command -v npm &>/dev/null && { echo "Error: npm not found"; exit 1; }
[[ -z "$1" ]] && { echo "Usage: $0 <project-name> [output-dir]"; exit 1; }
PROJECT_PATH="${2:-$(pwd)/app}"
TEMP_PATH="/tmp/temp-webapp-$$"

# ─────────────────────────────────────────────────────────────────────────────
# Project Creation
# ─────────────────────────────────────────────────────────────────────────────

echo "Creating project: $PROJECT_PATH"
mkdir -p $PROJECT_PATH
mkdir -p $TEMP_PATH

# ─────────────────────────────────────────────────────────────────────────────
# Dependencies
# ─────────────────────────────────────────────────────────────────────────────

echo "Installing dependencies..."

cp -r "$SCRIPTS_DIR/template"/* "$TEMP_PATH"/
ESCAPED_REPLACE=$(printf '%s\n' "$PROJECT_NAME" | sed 's/[\/&]/\\&/g')
$SED_INPLACE 's/<title>.*<\/title>/<title>'"$ESCAPED_REPLACE"'<\/title>/' "$TEMP_PATH"/index.html
cp -r "$TEMP_PATH"/* "$PROJECT_PATH"/

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────

echo "Using Node.js 20, Tailwind CSS v3.4.19, and Vite v7.2.4"
echo ""
echo "Tailwind CSS has been set up with the shadcn theme"
echo ""
echo "Setup complete: $PROJECT_PATH"
echo ""
echo "Components (40+):"
echo "  accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb,"
echo "  button-group, button, calendar, card, carousel, chart, checkbox, collapsible,"
echo "  command, context-menu, dialog, drawer, dropdown-menu, empty, field, form,"
echo "  hover-card, input-group, input-otp, input, item, kbd, label, menubar,"
echo "  navigation-menu, pagination, popover, progress, radio-group, resizable,"
echo "  scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner,"
echo "  spinner, switch, table, tabs, textarea, toggle-group, toggle, tooltip"
echo ""
echo "Usage:"
echo "  import { Button } from '@/components/ui/button'"
echo "  import { Card, CardHeader, CardTitle } from '@/components/ui/card'"
echo ""
echo "Structure:"
echo "  src/sections/        Page sections"
echo "  src/hooks/           Custom hooks"
echo "  src/types/           Type definitions"
echo "  src/App.css          Styles specific to the Webapp"
echo "  src/App.tsx          Root React component"
echo "  src/index.css        Global styles"
echo "  src/main.tsx         Entry point for rendering the Webapp"
echo "  index.html           Entry point for the Webapp"
echo "  tailwind.config.js   Configures Tailwind's theme, plugins, etc."
echo "  vite.config.ts       Main build and dev server settings for Vite"
echo "  postcss.config.js    Config file for CSS post-processing tools"