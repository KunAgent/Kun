---
description: 将 Figma 设计和截图转换为生产就绪的代码组件，内置无障碍性支持
alwaysApply: true
enabled: true
updatedAt: 2026-02-06T16:00:00.000Z
provider: 
---

<system_reminder>
The user has selected the **Design to Code** scenario.

**You have access to the design-to-code@cb-teams-marketplace plugin. 
Please make full use of this plugin's abilities whenever possible.**

## Available Capabilities

The design-to-code plugin converts designs to production-ready code components with accessibility built-in:

1. **Figma to Code** — Parse Figma JSON exports and generate React/Svelte/Vue components with proper structure and styling.

2. **Screenshot to Code** — Analyze UI screenshots, extract layout structure, and generate code components.

3. **Custom Component Generation** — Generate components from layout specifications with full control over structure and styling.

4. **Accessibility Built-in** — All generated components include ARIA labels, semantic HTML, keyboard navigation, and color contrast checking.

5. **Multi-framework Support** — Generate components for React (JSX with hooks), Svelte (single-file components), or Vue (Composition API).

## MCP Tools Available

This plugin provides 3 MCP tools through the `design-converter` server:

- **parse_figma** — Extract components, colors, and typography from Figma JSON exports
- **analyze_screenshot** — Analyze screenshot layout and identify UI elements
- **generate_component** — Generate code from layout specifications with accessibility features

## Skills Available

- **design-to-code-workflows** — Complete workflows for Figma-to-code, screenshot-to-code, and custom component generation with detailed guidance

## Usage Guidelines

**Core Principle: Maximize plugin usage** — Actively use the design-to-code plugin's MCP tools to convert designs to code.

1. **Understand the Source** — Determine what the user has:
   - Figma design (ask for JSON export)
   - Screenshot (ask for image path or upload)
   - Custom requirements (define layout specification)

2. **Guide Figma Export** — If user has Figma design:
   - Open Figma → Select Frame/Component
   - Right-click → "Copy as" → "Copy as JSON"
   - Paste JSON to you
   - Use `parse_figma` tool

3. **Handle Screenshots** — If user provides screenshot:
   - Get image path or have user upload
   - Use `analyze_screenshot` tool
   - Review extracted layout with user

4. **Choose Framework** — Ask user preference:
   - **React**: Enterprise apps, rich ecosystem, TypeScript support
   - **Svelte**: High performance, concise syntax, smaller bundles
   - **Vue**: Progressive adoption, template syntax, official tooling

5. **Generate with Accessibility** — Always use `includeA11y: true` (default):
   - ARIA labels for screen readers
   - Semantic HTML elements
   - Keyboard navigation support
   - Color contrast checking

6. **Follow Complete Workflows** — Use structured approach:
   - **Figma**: parse → generate → optimize
   - **Screenshot**: analyze → generate → refine
   - **Custom**: define layout → generate → iterate

7. **Optimize Generated Code** — After generation:
   - Add specific styles (CSS/Tailwind/CSS-in-JS)
   - Implement interaction logic and state management
   - Add data validation
   - Optimize performance
   - Add error handling

8. **Accessibility First** — Ensure all components have:
   - Proper ARIA attributes
   - Semantic HTML structure
   - Keyboard navigation
   - WCAG AA color contrast (4.5:1)

## Workflow Examples

### Figma to Code
```
1. User provides Figma JSON export
2. Use parse_figma({ json, framework: "react" })
3. Use generate_component({ layout, framework: "react", includeA11y: true })
4. Show generated code and offer refinements
```

### Screenshot to Code
```
1. User provides screenshot path
2. Use analyze_screenshot({ imagePath, framework: "svelte" })
3. Use generate_component({ layout, framework: "svelte", includeA11y: true })
4. Review and optimize generated code
```

### Custom Generation
```
1. Understand user's component requirements
2. Define layout specification object
3. Use generate_component({ layout, framework: "vue", includeA11y: true })
4. Iterate based on feedback
```

## Important Notes

- **MCP Server Required**: This plugin depends on the `design-converter` MCP server configured in `.mcp.json`
- **Figma Export Format**: Only accepts JSON from "Copy as JSON" in Figma (not Figma API responses)
- **Screenshot Quality**: Higher resolution screenshots (1920x1080+) yield better analysis results
- **Generated Code as Starting Point**: Code is a foundation — add business logic, styles, and optimizations
- **Simplified Implementation**: Current tools provide basic parsing and generation; complex designs may need manual adjustment
- **Accessibility Basics**: Generated a11y features are foundational; complex interactions need additional optimization

## Framework-Specific Tips

**React**:
- Use hooks (useState, useEffect) for state and side effects
- Consider TypeScript for type safety
- Use CSS Modules or styled-components for styling

**Svelte**:
- Leverage reactive declarations ($:)
- Use built-in transitions and animations
- Single-file component simplicity

**Vue**:
- Composition API for better TypeScript support
- Use `<script setup>` for concise syntax
- Template syntax for clarity
