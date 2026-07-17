---
name: skyline-wxss
description: Skyline WXSS 样式支持技能。提供 Skyline 支持的 CSS 属性、值和限制信息。触发关键词：WXSS、CSS 支持、样式兼容性、属性支持、不支持的属性、display grid、position sticky、overflow、filter、渐变、gradient、linear-gradient、radial-gradient、conic-gradient、border-style、white-space、font-weight、text-decoration、text-overflow、aspect-ratio、will-change、calc、env、mask、mask-image、background-image、transition、animation、transform、font-feature-settings。
---

# Skyline WXSS 样式支持

## 适用场景

- 检查某个 CSS 属性/值在 Skyline 下是否可用
- 排查 WXSS 样式在 Skyline 下不生效的问题
- 从 WebView 迁移到 Skyline 时评估样式兼容性
- 使用渐变、滤镜、遮罩等高级样式时了解限制
- 查阅 Skyline 支持的 CSS 属性语法

## 文档索引

| 我想要... | 查阅文档 |
|-----------|----------|
| 查看基础数据类型与语法符号 | `references/basics.md` |
| 查看布局/定位/盒模型语法 | `references/layout.md` |
| 查看 Flex 布局语法 | `references/flex.md` |
| 查看背景/边框/滤镜/遮罩语法 | `references/visual.md` |
| 查看文本/字体语法 | `references/text.md` |
| 查看动画/过渡/变换语法 | `references/animation.md` |
| 查看某属性是否支持 | 本文档 Quick Reference |
| 了解渐变/滤镜的具体限制 | 本文档「渐变与滤镜限制」规则 |

## 强制规则

### NEVER: 使用不支持的 CSS 属性

以下属性设置后**不生效**：

| 属性 | 分类 | 替代方案 |
|------|------|----------|
| `float` | 布局 | 使用 flex 布局 |
| `contain` | 布局 | 使用 `-wx-contain` |
| `resize` | 布局 | 无替代 |
| `writing-mode` | 文本 | 无替代 |
| `text-indent` | 文本 | 使用 padding-left 模拟 |
| `overflow-wrap` | 文本 | 使用 word-break |
| `text-decoration-thickness` | 文本 | 无替代 |
| `background-attachment` | 背景 | 无替代 |
| `background-clip` | 背景 | 无替代 |
| `background-origin` | 背景 | 无替代 |
| `mask-origin / mask-clip / mask-mode` | 遮罩 | 无替代 |
| `justify-items` | Flex | 无替代 |
| `list-style-type / list-style-image / list-style-position` | 列表 | 无替代 |

### MUST: 使用支持的属性值

部分属性可用但**特定值不支持**，会被静默忽略：

**Incorrect:**
```css
.container {
  display: grid;           /* grid 不支持 */
  position: sticky;        /* sticky 不支持 */
  overflow: auto;          /* auto 不支持 */
}
```

**Correct:**
```css
.container {
  display: flex;           /* 使用 flex 替代 grid */
  position: relative;      /* sticky 需使用 sticky-header 组件 */
  overflow: hidden;        /* 使用 hidden，滚动用 scroll-view */
}
```

### MUST: 注意渐变限制

渐变限制汇总：
- `radial-gradient` 仅支持 `circle` 形状（不支持 `ellipse`），尺寸仅支持 `px`，颜色停止仅支持 `%`
- `linear-gradient` 停止位置仅支持 `%` 和固定长度单位（px、rpx 等）
- `conic-gradient` 完全支持（无额外限制）

### MUST: 注意背景/遮罩多值限制

- `background-image` / `mask-image` 最多支持 **2 个值**
- `background-position` 最多支持 **2 组值**
- `background-repeat` / `background-size` **不支持多组值**

### MUST: calc() 不支持角度类型

`calc()` 支持长度计算，但**不支持角度计算**，需直接写角度值。

### MUST: text-overflow 仅在 text 组件生效

`text-overflow: ellipsis` 在 Skyline 下**仅在 `<text>` 组件上生效**，在 `<view>` 上不生效。推荐使用 `<text>` 组件的 `overflow` 和 `max-lines` 属性。

> ⚠️ 详见 `skyline-components` 技能了解 text 组件的属性限制。

### NEVER: 使用 filter 的 url() 和 drop-shadow()

filter/backdrop-filter 不支持 `url()` 和 `drop-shadow()`，也**不支持多个函数组合**。用 `box-shadow` 替代 `drop-shadow`。

支持的函数：`blur()`, `brightness()`, `contrast()`, `grayscale()`, `hue-rotate()`, `invert()`, `opacity()`, `saturate()`, `sepia()`。

### MUST: text-decoration-line 仅支持单值

仅支持单个值（`none`, `underline`, `overline`, `line-through`），不支持多值组合如 `underline line-through`。

### MUST: mask-image 渐变不可用

`mask-image` 的 `linear-gradient()` 和 `radial-gradient()` **不支持**，仅 `url()` 形式可用。

### MUST: 注意简写属性的部分有效行为

以下 CSS 简写属性在展开后，**部分子属性不生效**：

| 简写属性 | 不生效的子属性 |
|---------|---------------|
| `background` | `background-attachment`, `background-origin`, `background-clip` |
| `text-decoration` | `text-decoration-thickness` |
| `mask` | `mask-origin`, `mask-clip` |

> 💡 `mask-position` 简写**有效**：会自动展开为 `mask-position-x` + `mask-position-y`（类似 `background-position` 的机制）。

## Quick Reference

### 布局属性速查

| 属性 | 支持的值 | 不支持的值 |
|------|---------|-----------|
| `display` | `none`, `block`, `inline`, `inline-block`, `flex`, `inline-flex` | `grid`, `flow-root` |
| `position` | `static`, `relative`, `absolute`, `fixed` | `sticky` |
| `overflow` | `visible`, `hidden` | `auto`, `scroll`, `overflow-x`, `overflow-y` |
| `visibility` | `visible`, `hidden` | `collapse` |
| `box-sizing` | `content-box`, `border-box` | `padding-box` |
| `aspect-ratio` | `auto`, `<number>`, `<number>/<number>` | — |
| `content` | `none`, `normal`, `<string>`, `<url>` | — |
| `direction` | — | **不支持** |

### 文本属性速查

| 属性 | 支持的值 | 不支持的值 |
|------|---------|-----------|
| `white-space` | `normal`, `nowrap` | `pre`, `pre-wrap`, `pre-line` |
| `font-weight` | `normal`, `bold`, 数值(100-900) | `bolder`, `lighter` |
| `font-style` | `normal`, `italic` | `oblique` |
| `word-break` | `normal`, `break-all`, `keep-all` | `break-word`（映射为 normal） |
| `vertical-align` | `baseline`, `top`, `middle`, `bottom` | `text-top`, `text-bottom` |
| `text-align` | `left`, `center`, `right`, `justify`, `start`, `end` | `justify-all`, `match-parent` |
| `text-decoration-line` | `none`, `underline`, `overline`, `line-through`（仅单值） | 多值组合, `blink` |
| `text-overflow` | `clip`, `ellipsis`（⚠️ 仅 text 组件生效） | — |

### 边框与背景速查

| 属性 | 支持的值 | 不支持的值 |
|------|---------|-----------|
| `border-*-style` | `none`, `solid`, `dashed`, `dotted` | `hidden`, `double`, `groove`, `ridge`, `inset`, `outset` |
| `background-repeat` | `repeat`, `repeat-x`, `repeat-y`, `no-repeat` | `space`, `round` |

### Flex 属性（全部支持）

以下 Flex 属性的所有定义值**完全支持**：
`flex-direction`, `flex-wrap`, `align-items`, `align-self`, `align-content`, `justify-content`, `flex-grow`, `flex-shrink`, `flex-basis`, `order`

### 非标准默认值

以下属性的默认值与 Web 标准不同，需注意：

| 属性 | Skyline 默认值 | Web 标准默认值 | 条件 |
|------|---------------|---------------|------|
| `display` | `flex` | `inline` | `defaultDisplayBlock: true` 时为 `block` |
| `position` | `relative` | `static` | — |
| `box-sizing` | `border-box` | `content-box` | `defaultContentBox: true` 时为 `content-box` |
| `flex-direction` | `column` | `row` | `defaultDisplayBlock: true` 时为 `row` |
| `align-items` | `stretch` | `normal` | `defaultDisplayBlock: true` 时为 `normal` |
| `text-align` | `start` | `left` | — |
| `mask-repeat` | `no-repeat` | `repeat` | — |

### 完全支持的其他属性

`pointer-events`, `text-decoration-style`, `background-size`, `transform`, `opacity`, `transition-*`, `animation-*`, `border-radius`, `box-shadow`, `text-shadow`, `color`, `font-size`, `font-family`, `font-feature-settings`, `line-height`, `letter-spacing`, `word-spacing`, `z-index`, `aspect-ratio`, `content`, `will-change`（仅 `auto`/`contents`）, `conic-gradient`

## 相关技能

| 场景 | 推荐技能 | 说明 |
|------|----------|------|
| Skyline JSON 配置 | `skyline-config` | rendererOptions 影响默认 display/flex-direction/align-items/box-sizing |
| 组件使用 | `skyline-components` | scroll-view 替代 overflow:auto |
| Worklet 动画 | `skyline-worklet` | transform/opacity 动画最佳实践 |
| Skyline 概览 | `skyline-overview` | 渲染引擎概览与迁移指南 |


## References 目录结构

```
references/
├── basics.md      # 基础数据类型 + 语法符号说明
├── layout.md      # 布局、定位、盒模型
├── flex.md        # Flex 布局
├── visual.md      # 背景、边框、滤镜、遮罩
├── text.md        # 文本、字体
└── animation.md   # 变换、过渡、动画
```
