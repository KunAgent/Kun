---
name: mermaid-render
description: |
  Mermaid 图表渲染工具集 —— 将 Mermaid 源代码渲染为美化的 SVG 或 ASCII 图表。
  触发词：渲染图表、生成 SVG、Mermaid 渲染、图表美化、ASCII 图表、主题预览
---

# Mermaid 图表渲染

## 功能说明

将 Mermaid 标记语言源代码渲染为出版级的 SVG 矢量图或终端友好的 ASCII/Unicode 字符图。支持 6 种图表类型、15 种内置主题、自定义配色，以及丰富的布局参数调节。

## 环境准备

首次使用前，需执行安装脚本：

```bash
bash skills/mermaid-render/scripts/setup.sh
```

该脚本会在 `skills/mermaid-render/scripts/` 目录下安装渲染引擎依赖（仅需执行一次）。

## 调用方式

### SVG 渲染

```bash
node skills/mermaid-render/scripts/render-svg.js <输入文件> <输出文件> [主题名] [选项]
```

**参数说明：**
- `<输入文件>`：Mermaid 源代码文件路径（.mmd 或 .txt）
- `<输出文件>`：SVG 输出文件路径
- `[主题名]`：可选，内置主题名称（默认 zinc-light），见 @references/themes.md
- `[选项]`：JSON 格式的渲染选项，如 `'{"padding":60,"nodeSpacing":32}'`

**示例：**
```bash
# 使用默认主题渲染
node skills/mermaid-render/scripts/render-svg.js input.mmd output.svg

# 使用 tokyo-night 主题渲染
node skills/mermaid-render/scripts/render-svg.js input.mmd output.svg tokyo-night

# 使用自定义配色渲染
node skills/mermaid-render/scripts/render-svg.js input.mmd output.svg custom '{"bg":"#1a1a2e","fg":"#eaeaea","accent":"#e94560"}'
```

### ASCII 渲染

```bash
node skills/mermaid-render/scripts/render-ascii.js <输入文件> [选项]
```

**参数说明：**
- `<输入文件>`：Mermaid 源代码文件路径
- `[选项]`：JSON 格式的选项，如 `'{"useAscii":true}'`

**示例：**
```bash
# Unicode 渲染（默认）
node skills/mermaid-render/scripts/render-ascii.js input.mmd

# 纯 ASCII 渲染（兼容更多终端）
node skills/mermaid-render/scripts/render-ascii.js input.mmd '{"useAscii":true}'
```

### 主题列表

```bash
node skills/mermaid-render/scripts/list-themes.js
```

输出所有可用主题名称及配色预览。

## 参考资料

- 参考 @references/mermaid-syntax.md 了解完整的 Mermaid 语法速查
- 参考 @references/themes.md 了解所有内置主题和自定义配色方法
- 参考 @references/render-options.md 了解所有渲染参数配置

## 输出格式

### SVG 输出特点
- 基于 ELK.js 布局引擎的正交路由
- CSS 自定义属性注入颜色（支持实时切换主题）
- 形状感知边缘裁剪
- 可透明背景嵌入
- 支持自定义字体

### ASCII 输出特点
- Unicode box-drawing 字符绘制精美框图
- 可选纯 ASCII 兼容模式
- 支持终端 ANSI 着色
- 零 DOM 依赖，任何环境可用

## 注意事项

1. 渲染引擎为纯 TypeScript 实现，需要 Node.js 18+ 运行环境
2. 首次使用必须执行 `setup.sh` 安装依赖
3. SVG 输出包含内联样式，可直接在浏览器或文档中使用
4. ASCII 模式直接输出到 stdout，可通过重定向保存到文件
5. 自定义配色至少需提供 `bg` 和 `fg` 两个颜色值
