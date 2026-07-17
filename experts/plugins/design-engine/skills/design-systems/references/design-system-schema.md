# DESIGN.md 9 段结构规范

每套设计系统必须包含以下 9 个标准章节，确保 AI 可直接消费并精确生成代码。

---

## 1. Visual Theme（视觉主题）

定义整体设计哲学和视觉方向。

```markdown
## 1. Visual Theme

**Philosophy**: {一句话设计哲学}
**Direction**: {视觉方向关键词，如 "minimal, utilitarian, data-dense"}
**Personality**: {品牌性格，如 "confident, precise, approachable"}
**Reference**: {参考风格或灵感来源}
```

---

## 2. Color Palette（调色板）

使用 OKLCh 色彩空间定义，同时提供 HEX 和 CSS 变量。

```markdown
## 2. Color Palette

### Primary
| Token | HEX | OKLCh | Usage |
|-------|-----|-------|-------|
| --color-primary | #0066FF | oklch(55% 0.22 260) | CTA, links, active states |
| --color-primary-hover | #0052CC | oklch(48% 0.20 260) | Hover state |

### Neutral
| Token | HEX | Usage |
|-------|-----|-------|
| --color-bg | #FFFFFF | Page background |
| --color-surface | #F8F9FA | Card/section background |
| --color-border | #E2E8F0 | Dividers, outlines |
| --color-text-primary | #1A202C | Headings, body |
| --color-text-secondary | #64748B | Captions, metadata |

### Semantic
| Token | HEX | Usage |
|-------|-----|-------|
| --color-success | #10B981 | Positive states |
| --color-warning | #F59E0B | Caution states |
| --color-danger | #EF4444 | Error, destructive |
| --color-info | #3B82F6 | Informational |
```

---

## 3. Typography（排版）

完整的字体栈和排版层级。

```markdown
## 3. Typography

### Font Stacks
- **Heading**: {font-family fallback stack}
- **Body**: {font-family fallback stack}
- **Mono**: {font-family fallback stack}

### Scale
| Level | Size | Weight | Line-height | Usage |
|-------|------|--------|-------------|-------|
| Display | 48px / 3rem | 700 | 1.1 | Hero headings |
| H1 | 36px / 2.25rem | 700 | 1.2 | Page titles |
| H2 | 28px / 1.75rem | 600 | 1.3 | Section headings |
| H3 | 22px / 1.375rem | 600 | 1.4 | Subsections |
| Body | 16px / 1rem | 400 | 1.6 | Paragraphs |
| Small | 14px / 0.875rem | 400 | 1.5 | Captions, meta |
| Micro | 12px / 0.75rem | 500 | 1.4 | Badges, labels |
```

---

## 4. Component Styles（组件样式）

核心 UI 组件的样式规范。

```markdown
## 4. Component Styles

### Button
- Primary: {bg, text, border-radius, padding, hover state}
- Secondary: {bg, text, border, hover state}
- Ghost: {transparent bg, text color, hover state}

### Card
- Background: var(--color-surface)
- Border: 1px solid var(--color-border)
- Border-radius: {value}
- Padding: {value}
- Shadow: {value or "none"}

### Input
- Height: {value}
- Border: {value}
- Border-radius: {value}
- Focus ring: {value}
- Placeholder color: {value}

### Navigation
- Type: {top bar / sidebar / both}
- Active indicator: {underline / bg highlight / border}
- Height/Width: {value}
```

---

## 5. Layout（布局）

栅格系统和间距体系。

```markdown
## 5. Layout

### Grid
- Container max-width: {value}
- Columns: {12 / 16 / flexible}
- Gutter: {value}

### Spacing Scale
| Token | Value | Usage |
|-------|-------|-------|
| --space-xs | 4px | Inline spacing |
| --space-sm | 8px | Tight spacing |
| --space-md | 16px | Default spacing |
| --space-lg | 24px | Section padding |
| --space-xl | 32px | Major separations |
| --space-2xl | 48px | Section gaps |
| --space-3xl | 64px | Hero padding |
```

---

## 6. Depth & Elevation（深度与层级）

```markdown
## 6. Depth & Elevation

| Level | Shadow | Usage |
|-------|--------|-------|
| Flat | none | Default surfaces |
| Raised | 0 1px 3px rgba(0,0,0,0.1) | Cards, dropdowns |
| Floating | 0 4px 12px rgba(0,0,0,0.1) | Modals, popovers |
| Overlay | 0 8px 24px rgba(0,0,0,0.15) | Full-screen overlays |

### Z-index Scale
- Base: 0
- Dropdown: 100
- Sticky: 200
- Modal: 300
- Toast: 400
```

---

## 7. Cautions（注意事项）

设计反模式和禁区。

```markdown
## 7. Cautions

### Never Do
- {禁止的模式1}
- {禁止的模式2}
- {禁止的模式3}

### Prefer
- {推荐的替代方案1}
- {推荐的替代方案2}
```

---

## 8. Responsive Behavior（响应式行为）

```markdown
## 8. Responsive Behavior

### Breakpoints
| Name | Width | Behavior |
|------|-------|----------|
| Mobile | < 640px | Single column, stacked |
| Tablet | 640-1024px | 2 columns, condensed nav |
| Desktop | > 1024px | Full layout |

### Adaptation Rules
- {响应式规则1}
- {响应式规则2}
```

---

## 9. Agent Prompt Guide（Agent 生成指南）

```markdown
## 9. Agent Prompt Guide

### Key Instructions
- {AI 生成时的关键注意事项1}
- {AI 生成时的关键注意事项2}

### Quick CSS Snippet
\```css
:root {
  /* Paste core tokens here for quick consumption */
}
\```
```
