# Lucide Icons Skill

A CodeBuddy skill for searching, downloading, and customizing [Lucide icons](https://lucide.dev/) - a beautiful & consistent icon library with 1000+ icons.

## Features

- Search icons by name or keyword with fuzzy matching
- Download icons as SVG files
- Generate TypeScript React components
- Customize icons (color, size, stroke width)
- Metadata caching for fast searches
- Works offline with local cache

## Installation

### 1. Install Dependencies

```bash
cd ~/.codebuddy/skills/lucide-icons/scripts
npm install
```

### 2. (Optional) Install lucide-static for offline support

```bash
npm install lucide-static
```

## Usage

### Command Line

```bash
# Using node directly
node ~/.codebuddy/skills/lucide-icons/scripts/lucide.js <command>

# Or create an alias in your shell config
alias lucide="node ~/.codebuddy/skills/lucide-icons/scripts/lucide.js"
```

### Commands

#### Search Icons

```bash
lucide search <keyword> [options]

Options:
  -l, --limit <number>  Maximum results (default: 20)
  --json                Output as JSON
```

Examples:
```bash
lucide search heart
lucide search arrow --limit 10
lucide search user --json
```

#### Download Icon

```bash
lucide download <icon-name> [options]

Options:
  -o, --output <dir>        Output directory (default: .)
  -f, --format <formats>    Output formats: svg,react (default: svg)
  -c, --color <color>       Icon color (default: currentColor)
  -s, --size <size>         Icon size in pixels (default: 24)
  -w, --stroke-width <n>    Stroke width (default: 2)
  --overwrite               Overwrite existing files
  --json                    Output as JSON
```

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

#### List All Icons

```bash
lucide list [options]

Options:
  -l, --limit <number>   Results per page (default: 50)
  --offset <number>      Skip first N results (default: 0)
  --json                 Output as JSON
```

Examples:
```bash
lucide list
lucide list --limit 100
lucide list --offset 50 --limit 50
```

#### Icon Info

```bash
lucide info <icon-name> [options]

Options:
  --json    Output as JSON
```

Examples:
```bash
lucide info heart
lucide info chevron-right --json
```

#### Refresh Cache

```bash
lucide refresh
```

## Output Formats

### SVG

Standard SVG file with Lucide's default styling:
- 24x24 viewBox
- stroke-based icons
- `currentColor` for easy CSS styling

Example output (`heart.svg`):
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
</svg>
```

### React Component (TypeScript)

Generates a fully-typed React functional component with:
- TypeScript interfaces for props
- Customizable size, color, strokeWidth
- className and style support
- Accessibility props (aria-label)
- onClick handler support

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

## Data Sources

The skill uses multiple data sources in order of preference:

1. **lucide-static** (npm package) - Fastest, works offline
2. **GitHub Raw Content** - No rate limiting, no authentication needed
3. **GitHub API** - Fallback for icon listing

## Caching

- Icon metadata is cached in `~/.codebuddy/skills/lucide-icons/cache/`
- Cache TTL: 24 hours
- Use `lucide refresh` to force cache update

## Customization Options

### Color
Any valid CSS color value:
- Named colors: `red`, `blue`, `green`
- Hex: `#ff0000`, `#f00`
- RGB: `rgb(255, 0, 0)`
- HSL: `hsl(0, 100%, 50%)`
- CSS variables: `var(--primary-color)`

### Size
Any number (interpreted as pixels):
- `24` (default)
- `16`, `20`, `32`, `48`, etc.

### Stroke Width
Any number:
- `2` (default)
- `1`, `1.5`, `2.5`, `3`, etc.

## Error Handling

The skill handles common errors gracefully:

- **Icon not found**: Suggests similar icons
- **File exists**: Prompts to use `--overwrite`
- **Permission denied**: Shows clear error message
- **Network errors**: Falls back to cached data or local package

## Integration with CodeBuddy

When using with CodeBuddy, you can ask:

> "Search for heart-related icons"

CodeBuddy will execute:
```bash
node ~/.codebuddy/skills/lucide-icons/scripts/lucide.js search heart
```

> "Download the heart icon as SVG and React component to ./src/icons/"

CodeBuddy will execute:
```bash
node ~/.codebuddy/skills/lucide-icons/scripts/lucide.js download heart \
  --format svg,react \
  --output ./src/icons/
```

## Troubleshooting

### "Cannot find module" errors
Make sure dependencies are installed:
```bash
cd ~/.codebuddy/skills/lucide-icons/scripts && npm install
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

## License

MIT

## Credits

- Icons by [Lucide](https://lucide.dev/)
- Skill created for [CodeBuddy](https://codebuddy.dev/)
