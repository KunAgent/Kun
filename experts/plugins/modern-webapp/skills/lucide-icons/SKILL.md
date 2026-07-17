---
name: lucide-icons
description: Search, download, and customize Lucide icons (1000+ beautiful SVG icons). Supports SVG and TypeScript React component generation with full customization options.
allowed-tools: Bash(lucide-icons:*)
---

# Lucide Icons Skill

Search, download, and customize Lucide icons - a beautiful & consistent icon library with 1000+ icons.

## Features

- Search icons by name or keyword with fuzzy matching
- Download icons as SVG files
- Generate TypeScript React components with full type safety
- Customize icons (color, size, stroke width)
- Metadata caching for fast searches
- Works offline with local cache (optional lucide-static package)
- Multiple data sources with automatic fallback

## Quick Start

```bash
# Search for icons
lucide search heart

# Download an icon
lucide download heart --output ./icons/

# Download with React component
lucide download heart --output ./icons/ --format svg,react

# Customize icon
lucide download star --color "#ffd700" --size 32 --stroke-width 1.5
```

## Installation

Before first use, install dependencies in the skill's scripts directory:

```bash
cd scripts && npm install
```

**Optional - For offline support:**
```bash
npm install lucide-static
```

## Commands

### search `<keyword>`
Search for icons by name or keyword.

```bash
lucide search heart --limit 10
```

### download `<icon-name>`
Download a single icon with optional customization.

Options:
- `-o, --output <dir>` - Output directory (default: current directory)
- `-f, --format <formats>` - Output formats: `svg`, `react`, or `svg,react` (default: `svg`)
- `-c, --color <color>` - Icon color (default: `currentColor`)
- `-s, --size <size>` - Icon size in pixels (default: `24`)
- `-w, --stroke-width <width>` - Stroke width (default: `2`)
- `--overwrite` - Overwrite existing files
- `--json` - Output as JSON

Examples:
```bash
# Basic download
lucide download heart --output ./icons/

# With React component
lucide download heart --format svg,react --output ./src/icons/

# Customized icon
lucide download star --color "#ffd700" --size 32 --stroke-width 1.5

# Overwrite existing
lucide download check --output ./icons/ --overwrite
```

### list
List all available icons.

```bash
lucide list --limit 50
```

### info `<icon-name>`
Show detailed information about an icon.

```bash
lucide info heart
```

### refresh
Refresh the icon metadata cache.

```bash
lucide refresh
```

## Installation

Before first use, install dependencies:

```bash
cd ~/.codebuddy/skills/lucide-icons/scripts && npm install
```

## Output Formats

### SVG
Standard SVG file with Lucide's default styling:
- 24x24 viewBox
- Stroke-based icons
- `currentColor` for easy CSS styling
- Customizable color, size, and stroke-width

Example output (`heart.svg`):
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
     fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
</svg>
```

### React (TypeScript)
Generates a fully-typed React functional component with:
- TypeScript interfaces for props
- Customizable size, color, strokeWidth
- className and style support
- Accessibility props (aria-label)
- onClick handler support
- Full type safety

Example output (`HeartIcon.tsx`):
```tsx
import React from 'react';

export interface HeartIconProps {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  className?: string;
  style?: React.CSSProperties;
  'aria-label'?: string;
  onClick?: React.MouseEventHandler<SVGSVGElement>;
}

export const HeartIcon: React.FC<HeartIconProps> = ({
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
  className,
  style,
  'aria-label': ariaLabel,
  onClick,
  ...props
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-label={ariaLabel}
      onClick={onClick}
      role={ariaLabel ? 'img' : undefined}
      aria-hidden={!ariaLabel}
      {...props}
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
    </svg>
  );
};

HeartIcon.displayName = 'HeartIcon';
export default HeartIcon;
```

## Examples

```bash
# Download heart icon to src/icons/
lucide download heart -o ./src/icons/

# Download with custom color and size
lucide download star --color "#ffd700" --size 32 -o ./icons/

# Generate both SVG and React component
lucide download check-circle --format svg,react -o ./src/components/icons/

# Search for arrow icons
lucide search arrow --limit 20
```

## Customization Options

### Color
Any valid CSS color value:
- Named colors: `red`, `blue`, `green`
- Hex: `#ff0000`, `#f00`
- RGB: `rgb(255, 0, 0)`
- HSL: `hsl(0, 100%, 50%)`
- CSS variables: `var(--primary-color)`
- Default: `currentColor` (inherits from parent)

### Size
Any number (interpreted as pixels):
- `24` (default)
- `16`, `20`, `32`, `48`, etc.

### Stroke Width
Any number:
- `2` (default)
- `1`, `1.5`, `2.5`, `3`, etc.

## Data Sources

The skill uses multiple data sources in order of preference:

1. **lucide-static** (npm package) - Fastest, works offline
2. **GitHub Raw Content** - No rate limiting, no authentication needed
3. **GitHub API** - Fallback for icon listing

## Caching

- Icon metadata is cached in the skill's `cache/` directory
- Cache TTL: 24 hours
- Use `lucide refresh` to force cache update
- Works offline with cached data

## Error Handling

The skill handles common errors gracefully:

- **Icon not found**: Suggests similar icons
- **File exists**: Prompts to use `--overwrite`
- **Permission denied**: Shows clear error message
- **Network errors**: Falls back to cached data or local package

## Troubleshooting

### "Cannot find module" errors
Make sure dependencies are installed:
```bash
cd scripts && npm install
```

### Rate limiting from GitHub
Install `lucide-static` for local icon access:
```bash
npm install lucide-static
```

### Outdated icon list
Refresh the cache:
```bash
lucide refresh
```

## Data Source

Icons are fetched from the official [Lucide repository](https://github.com/lucide-icons/lucide).

## More Information

See [README.md](./README.md) for detailed documentation.
