# 渲染选项参考

## SVG 渲染选项 (RenderOptions)

### 颜色参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `bg` | string | `#FFFFFF` | 背景色，映射到 CSS 变量 `--bg` |
| `fg` | string | `#27272A` | 前景/文本色，映射到 CSS 变量 `--fg` |
| `line` | string? | 自动推导 | 连线/连接器色，映射到 `--line` |
| `accent` | string? | 自动推导 | 箭头/高亮色，映射到 `--accent` |
| `muted` | string? | 自动推导 | 次要文本/标签色，映射到 `--muted` |
| `surface` | string? | 自动推导 | 节点填充色，映射到 `--surface` |
| `border` | string? | 自动推导 | 节点/分组边框色，映射到 `--border` |

### 布局参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `padding` | number | `40` | 画布内边距（px） |
| `nodeSpacing` | number | `24` | 水平方向兄弟节点间距（px） |
| `layerSpacing` | number | `40` | 垂直方向层间距（px） |
| `componentSpacing` | number | `24` | 断开组件之间的间距（px） |
| `thoroughness` | number | `3` | 交叉最小化优化级别（1-7，越高越好但越慢） |

### 渲染参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `font` | string | `Inter` | 字体族名称 |
| `transparent` | boolean | `false` | 透明背景（不渲染 bg 矩形） |
| `interactive` | boolean | `false` | 启用 XY 图表的悬浮提示（仅 xychart） |

---

## ASCII 渲染选项 (AsciiRenderOptions)

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `useAscii` | boolean | `false` | `true`=纯 ASCII（`+---+`），`false`=Unicode（`┌───┐`） |
| `paddingX` | number | `5` | 水平方向节点间距 |
| `paddingY` | number | `5` | 垂直方向节点间距 |
| `boxBorderPadding` | number | `1` | 节点内文字边距 |
| `colorMode` | string | `auto` | 着色模式（见下表） |
| `theme` | object? | — | 自定义 ASCII 颜色主题 |

### colorMode 取值

| 值 | 说明 |
|------|------|
| `none` | 无着色，纯文本输出 |
| `auto` | 自动检测终端能力 |
| `ansi16` | 16 色 ANSI |
| `ansi256` | 256 色 ANSI |
| `truecolor` | 24-bit 真彩色 ANSI |
| `html` | HTML `<span>` 着色（适合网页嵌入） |

---

## 使用示例

### 命令行调用

```bash
# 最简用法
node render-svg.js input.mmd output.svg

# 指定主题
node render-svg.js input.mmd output.svg tokyo-night

# 自定义配色 + 布局参数
node render-svg.js input.mmd output.svg custom '{"bg":"#1a1a2e","fg":"#eaeaea","accent":"#e94560","padding":60,"nodeSpacing":32,"layerSpacing":48}'

# 透明背景（适合嵌入 UI）
node render-svg.js input.mmd output.svg github-light '{"transparent":true}'

# 高质量优化（慢速但布局更优）
node render-svg.js input.mmd output.svg zinc-light '{"thoroughness":7}'

# 交互式 XY 图表
node render-svg.js chart.mmd chart.svg catppuccin-latte '{"interactive":true}'
```

### ASCII 调用

```bash
# Unicode 输出（默认，更美观）
node render-ascii.js input.mmd

# 纯 ASCII（兼容所有终端）
node render-ascii.js input.mmd '{"useAscii":true}'

# 强制真彩色
node render-ascii.js input.mmd '{"colorMode":"truecolor"}'

# 无着色（适合管道/重定向）
node render-ascii.js input.mmd '{"colorMode":"none"}' > output.txt

# HTML 着色（适合网页展示）
node render-ascii.js input.mmd '{"colorMode":"html"}' > output.html
```

---

## 布局参数调优指南

### nodeSpacing（节点间距）

| 值 | 效果 | 适用场景 |
|------|------|---------|
| 16 | 紧凑 | 节点多、空间有限 |
| 24 | 默认 | 通用 |
| 32-40 | 宽松 | 强调清晰度 |
| 48+ | 很宽松 | 少量节点、演示用 |

### layerSpacing（层间距）

| 值 | 效果 | 适用场景 |
|------|------|---------|
| 24 | 紧凑 | 层级多时压缩空间 |
| 40 | 默认 | 通用 |
| 56-64 | 宽松 | 强调层级关系 |

### thoroughness（优化级别）

| 值 | 速度 | 质量 | 适用场景 |
|------|------|------|---------|
| 1 | 最快 | 基本 | 实时预览、大图 |
| 3 | 默认 | 良好 | 通用 |
| 5 | 较慢 | 优秀 | 最终输出 |
| 7 | 最慢 | 最优 | 复杂图表、对交叉敏感 |

### padding（画布内边距）

| 值 | 适用场景 |
|------|---------|
| 20 | 空间紧凑时 |
| 40 | 默认，通用 |
| 60-80 | 独立展示、PPT 嵌入 |

---

## 技术说明

### 布局引擎
- 使用 ELK.js（Eclipse Layout Kernel）层次化布局算法
- 同步执行（通过 FakeWorker bypass，无 setTimeout 延迟）
- 支持正交路由（边不对角线穿越节点）
- 形状感知边缘裁剪（边终止于节点实际形状边界）

### SVG 特点
- 所有颜色注入为 CSS 自定义属性
- 支持 `color-mix()` 自动推导中间色
- 多行文本使用 `<tspan>` 元素
- 支持格式化标签：`<b>`、`<i>`、`<s>`、`<u>`

### 性能参考
- 100+ 张图渲染 < 500ms
- 单张典型图表 < 50ms
- 内存占用极低，无 DOM 操作
