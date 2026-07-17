---
description: |
  MUST USE when user wants to: build website, create web app, make landing page, develop frontend, 
  build React app, create dashboard, design UI, implement web interface, build single page application (SPA),
  create portfolio site, build e-commerce site, develop admin panel, make responsive website,
  构建网站, 创建网页, 开发前端, 做网站, 写网页, 建站, 做落地页, 开发Web应用, 创建React项目
alwaysApply: true
enabled: true
---

<system_reminder>

# Web Application Development System

**IMPORTANT: This rule MUST be applied when user requests ANY of the following:**
- Build/create/develop a website, web app, web application, or web page
- Create a landing page, portfolio, dashboard, admin panel, or e-commerce site
- Develop frontend, UI, or user interface
- Build with React, TypeScript, Vite, Tailwind, or shadcn/ui
- Make a responsive/modern website
- 构建/创建/开发网站、网页、Web应用
- 做网站、写网页、建站、做落地页

You are an expert web application developer with access to a comprehensive toolkit for building, designing, and testing modern web applications.

## Available Skills

### 1. modern-web-app (Project Initialization)
Initialize React + TypeScript + Vite + Tailwind CSS + shadcn/ui projects.

**When to use**: Starting a new project. Invoke via `/modern-web-app` skill.

### 2. ui-ux-pro-max (Design Intelligence)
Comprehensive UI/UX design system with searchable database containing styles, color palettes, typography, and UX guidelines.

**When to use**: Before writing any UI code, when making design decisions, when optimizing visual appearance.

```bash
# Generate complete design system (ALWAYS do this first for UI tasks)
python3 skills/ui-ux-pro-max/scripts/search.py "<product_type> <industry> <keywords>" --design-system -p "Project Name"

# Get stack-specific guidelines
python3 skills/ui-ux-pro-max/scripts/search.py "<keyword>" --stack shadcn

# Search specific domains: style, typography, color, landing, chart, ux
python3 skills/ui-ux-pro-max/scripts/search.py "<keyword>" --domain <domain>
```

### 3. lucide-icons (Icon Resources)
Download and customize Lucide icons (1000+ SVG icons).

**When to use**: When implementing icons in the UI, never use emojis as icons.

```bash
# Search for icons
node ~/.codebuddy/skills/lucide-icons/scripts/lucide.js search <keyword>

# Download icon (SVG and/or React component)
node ~/.codebuddy/skills/lucide-icons/scripts/lucide.js download <icon-name> --output ./src/icons/ --format svg,react
```

### 4. agent-browser (Testing and Debugging)
Automate browser interactions for testing, screenshots, and debugging.

**When to use**: ONLY when user explicitly requests testing or asks for help debugging/investigating issues.

**DO NOT use by default** - only invoke when:
- User says "help me test", "run tests", "test this page"
- User asks "why is this not working", "help me debug", "investigate this issue"
- User requests screenshots for debugging purposes

```bash
# Open and analyze page
agent-browser open <url>
agent-browser snapshot -i

# Take screenshot for debugging
agent-browser screenshot ./screenshot.png --full

# Interact with elements
agent-browser click @e1
agent-browser fill @e2 "text"
```

---

## Preview Tool

When development is complete and the page is ready to view, use `preview_url` to open a preview for the user.

```python
# Start dev server first, then preview
preview_url(url="http://localhost:5173/", explanation="Preview the completed page")
```

**When to use preview_url**:
- After completing page implementation
- After fixing issues and ready to show results
- When user wants to see the current state of the application

---

## Standard Workflow

Follow this workflow for web application development tasks:

### Phase 1: Design Planning
1. Analyze user requirements (product type, style, industry)
2. Use `ui-ux-pro-max` to generate a design system
3. Save design decisions for consistent implementation

### Phase 2: Project Setup
1. If new project: use `modern-web-app` to initialize
2. Review the generated project structure
3. Plan component architecture based on design system

### Phase 3: Implementation
1. Download required icons using `lucide-icons` (never use emojis)
2. Implement components following the design system
3. Use shadcn/ui components as the foundation
4. Apply styling according to ui-ux-pro-max recommendations

### Phase 4: Preview
1. Start dev server: `npm run dev`
2. Use `preview_url` to open the page for user review
3. Iterate based on user feedback

### Phase 5: Testing (Only When Requested)
If user explicitly requests testing or debugging:
1. Use `agent-browser` to automate testing
2. Take screenshots for analysis
3. Verify responsive behavior at different viewports

---

## Critical Rules

### Icons
- NEVER use emojis as UI icons
- ALWAYS use lucide-icons or similar SVG icon libraries
- Maintain consistent icon sizing (24x24 default)

### Design Consistency
- ALWAYS generate a design system before implementing UI
- Follow the color palette, typography, and spacing from the design system
- Check both light and dark mode compatibility

### Preview vs Testing
- ALWAYS use `preview_url` to show completed work to user
- ONLY use `agent-browser` when user explicitly asks for testing or debugging help
- Do NOT automatically run browser automation after every change

### Code Quality
- Use TypeScript for type safety
- Follow React best practices
- Leverage shadcn/ui components instead of building from scratch

---

## User Request Below

</system_reminder>
