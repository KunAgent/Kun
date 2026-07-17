---
name: modern-web-app
description: Tools for building modern React webapps with TypeScript, Tailwind CSS and shadcn/ui. Best suited for applications with complex UI components and state management.
---

# modern-web-app

Stack: React + TypeScript + Vite + Tailwind CSS + shadcn/ui

## Workflow

1. `scripts/init-webapp.sh <website-title> [output-dir]` - Initialize project
2. Edit source code in `src/`
3. Build the React app
4. Deploy the build output in `dist/`

## Quick Start

### 1. Initialize

```bash
# Init project in ./app (default) with website title
bash scripts/init-webapp.sh "My Website"

# Or specify custom output directory
bash scripts/init-webapp.sh "My Website" ./my-project

cd ./app  # or your custom directory
```

**AI Agent Notes**:
- Default project path is `./app` (relative to current working directory)
- Second argument allows custom output directory
- Non-interactive execution with auto-confirm

This creates a fully configured project with:

- React + TypeScript (via Vite)
- Tailwind CSS 3.4.19 with shadcn/ui theming system
- Path aliases (`@/`) configured
- 40+ shadcn/ui components pre-installed
- All Radix UI dependencies included
- Production build optimization with Vite
- Node 20+ compatibility (auto-detects and pins Vite version)

### 2. Develop

Edit generated files in `src/`:
- Page sections: `src/sections/`
- Custom React hooks: `src/hooks/`
- TypeScript definitions: `src/types/`

### 3. Build

```bash
cd ./app && npm run build 2>&1
```

**Output** (`dist/`):
- `index.html` - Entry point
- `assets/index-[hash].js` - Bundled JS
- `assets/index-[hash].css` - Bundled CSS
- Optimized images, fonts, other assets

**Optimizations**: Tree-shaking, code splitting, asset compression, minification, cache-busting hashes.

### 4. Deploy

Deploy the build output in `<project-dir>/dist/`

## Debugging

1. Fix source files
2. `npm run build`
3. Test `dist/`
4. Redeploy

## Reference

- [shadcn/ui Components](https://ui.shadcn.com/docs/components)
