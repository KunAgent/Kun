# 主题配色参考

## 一、配色系统原理

### 双色基础

所有图表只需两个基础色即可自动推导完整配色：

| 变量 | 说明 | CSS 变量 |
|------|------|---------|
| `bg` | 背景色 | `--bg` |
| `fg` | 前景色（文本） | `--fg` |

系统通过 `color-mix()` 从 bg/fg 自动推导出以下层级：

| 元素 | 推导规则 | 权重 |
|------|---------|------|
| 主文本 | fg 100% | 100 |
| 次要文本 | fg 60% 混入 bg | 60 |
| 边标签 | fg 40% 混入 bg | 40 |
| 淡化文本 | fg 25% 混入 bg | 25 |
| 连线 | fg 50% 混入 bg | 50 |
| 箭头 | fg 85% 混入 bg | 85 |
| 节点填充 | fg 3% 混入 bg | 3 |
| 分组标题 | fg 5% 混入 bg | 5 |
| 内边框 | fg 12% 混入 bg | 12 |
| 节点边框 | fg 20% 混入 bg | 20 |

### 富化模式（可选）

提供额外颜色覆盖自动推导值：

| 变量 | 说明 | CSS 变量 | 覆盖目标 |
|------|------|---------|---------|
| `line` | 连线/连接器色 | `--line` | 边/连接线 |
| `accent` | 强调色 | `--accent` | 箭头、高亮、XY 图表系列色 |
| `muted` | 低调色 | `--muted` | 次要文本、边标签 |
| `surface` | 表面色 | `--surface` | 节点填充 |
| `border` | 边框色 | `--border` | 节点/分组边框 |

### 自定义主题示例

**极简双色**：
```json
{"bg": "#0f0f0f", "fg": "#e0e0e0"}
```

**丰富配色**：
```json
{
  "bg": "#0f0f0f",
  "fg": "#e0e0e0",
  "accent": "#ff6b6b",
  "muted": "#666666",
  "line": "#444444",
  "surface": "#1a1a1a",
  "border": "#333333"
}
```

---

## 二、内置主题详情

### 浅色主题

#### zinc-light（默认通用）
```json
{"bg": "#FFFFFF", "fg": "#27272A"}
```
- 适用：通用文档、打印输出、白底场景
- 特点：纯黑白极简，所有颜色自动推导

#### tokyo-night-light
```json
{"bg": "#d5d6db", "fg": "#343b58", "line": "#34548a", "accent": "#34548a", "muted": "#9699a3"}
```
- 适用：技术文档、代码说明
- 特点：淡灰底+深蓝强调，温和不刺眼

#### catppuccin-latte
```json
{"bg": "#eff1f5", "fg": "#4c4f69", "line": "#9ca0b0", "accent": "#8839ef", "muted": "#9ca0b0"}
```
- 适用：设计文档、创意项目
- 特点：淡紫强调，优雅温暖

#### nord-light
```json
{"bg": "#eceff4", "fg": "#2e3440", "line": "#aab1c0", "accent": "#5e81ac", "muted": "#7b88a1"}
```
- 适用：企业报告、正式文档
- 特点：冰蓝色调，北欧极简

#### github-light
```json
{"bg": "#ffffff", "fg": "#1f2328", "line": "#d1d9e0", "accent": "#0969da", "muted": "#59636e"}
```
- 适用：GitHub README、开源文档、Markdown
- 特点：GitHub 标志蓝强调，开发者熟悉

#### solarized-light
```json
{"bg": "#fdf6e3", "fg": "#657b83", "line": "#93a1a1", "accent": "#268bd2", "muted": "#93a1a1"}
```
- 适用：学术论文、长时间阅读
- 特点：暖黄底色，护眼

---

### 深色主题

#### zinc-dark
```json
{"bg": "#18181B", "fg": "#FAFAFA"}
```
- 适用：深色 UI 嵌入
- 特点：纯黑白极简深色版

#### tokyo-night
```json
{"bg": "#1a1b26", "fg": "#a9b1d6", "line": "#3d59a1", "accent": "#7aa2f7", "muted": "#565f89"}
```
- 适用：开发者文档、技术博客
- 特点：经典深色主题，蓝紫色调

#### tokyo-night-storm
```json
{"bg": "#24283b", "fg": "#a9b1d6", "line": "#3d59a1", "accent": "#7aa2f7", "muted": "#565f89"}
```
- 适用：IDE 集成、稍亮深色场景
- 特点：比 tokyo-night 背景略亮

#### catppuccin-mocha
```json
{"bg": "#1e1e2e", "fg": "#cdd6f4", "line": "#585b70", "accent": "#cba6f7", "muted": "#6c7086"}
```
- 适用：创意项目、设计展示
- 特点：淡紫强调色，柔和深色

#### nord
```json
{"bg": "#2e3440", "fg": "#d8dee9", "line": "#4c566a", "accent": "#88c0d0", "muted": "#616e88"}
```
- 适用：北欧极简风格
- 特点：冰蓝色调深色版

#### dracula
```json
{"bg": "#282a36", "fg": "#f8f8f2", "line": "#6272a4", "accent": "#bd93f9", "muted": "#6272a4"}
```
- 适用：暗黑风格、个人项目
- 特点：经典 Dracula 紫色

#### github-dark
```json
{"bg": "#0d1117", "fg": "#e6edf3", "line": "#3d444d", "accent": "#4493f8", "muted": "#9198a1"}
```
- 适用：GitHub Dark Mode、深色 README
- 特点：GitHub 深色版标志蓝

#### solarized-dark
```json
{"bg": "#002b36", "fg": "#839496", "line": "#586e75", "accent": "#268bd2", "muted": "#586e75"}
```
- 适用：终端友好、深色阅读
- 特点：Solarized 经典深色，护眼

#### one-dark
```json
{"bg": "#282c34", "fg": "#abb2bf", "line": "#4b5263", "accent": "#c678dd", "muted": "#5c6370"}
```
- 适用：编辑器风格
- 特点：VS Code One Dark 风格，紫色强调

---

## 三、场景推荐

| 场景 | 推荐主题 | 原因 |
|------|---------|------|
| 技术文档/README | github-light | 开发者最熟悉的风格 |
| PPT/演示（浅色） | nord-light | 专业正式 |
| PPT/演示（深色） | tokyo-night | 视觉冲击力 |
| 打印输出 | zinc-light | 纯黑白，省墨 |
| UI 嵌入（浅色） | catppuccin-latte | 优雅温暖 |
| UI 嵌入（深色） | catppuccin-mocha | 柔和不刺眼 |
| 终端/CLI 文档 | solarized-dark | 终端配色协调 |
| 学术论文 | solarized-light | 暖底护眼 |
| 品牌自定义 | custom（双色模式） | 输入品牌主色即可 |

---

## 四、VS Code 主题兼容

可通过 Shiki 集成直接使用任何 VS Code 主题配色：

```javascript
import { fromShikiTheme } from 'beautiful-mermaid'

// 颜色映射规则
// editor.background   → bg
// editor.foreground   → fg
// editorLineNumber.foreground → line
// focusBorder / keyword token → accent
// comment token       → muted
// editor.selectionBackground → surface
// editorWidget.border → border
```

---

## 五、CSS 自定义属性（实时切换）

渲染后的 SVG 使用 CSS 自定义属性，支持在不重新渲染的情况下切换主题：

```css
/* 渲染时使用 CSS 变量 */
svg {
  --bg: var(--my-background);
  --fg: var(--my-foreground);
  --accent: var(--my-accent);
}

/* 切换主题只需改变变量值 */
.dark svg {
  --bg: #1a1b26;
  --fg: #a9b1d6;
}
```

对 React 应用，渲染时传入 CSS 变量引用：
```javascript
renderMermaidSVG(code, {
  bg: 'var(--background)',
  fg: 'var(--foreground)',
  transparent: true
})
```
