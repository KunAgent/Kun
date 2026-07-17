# 视觉资产生成策略

> 阶段4加载 | 封面/插图/Mermaid视觉资产策略
> 图表体系见 `templates.md` §八；排版规则见 `typography.md`；降级策略见 `build.md`

---

## §1 封面生成策略

### 三层路径

| 层级 | 方式 | 条件 | 说明 |
|------|------|------|------|
| **L1 位图封面** | 用户提供 `coverImage`；或宿主在对话中生成图像（**保存为项目内文件**并在配置中引用） | 依赖用户落盘路径与审核 | 品质取决于素材与宿主工具 |
| **L2 SVG设计封面** | 在 SVG 文字封面上叠加装饰元素 | `visualPreset` 字段非空 | 自动生成，无外部图像 API |
| **L3 SVG文字封面** | 纯文字+渐变色块 | 兜底 | 现有默认方案 |

用户提供 `coverImage`（外部图片）时跳过以上三层，直接使用。

### 封面装饰×预设映射

| 预设 | visualPreset | 装饰元素 | 视觉意图 |
|------|-------------|---------|---------|
| 🅰 实战手册 | `geometric` | 几何线条网格 + 工具图标轮廓 | 系统化、可操作 |
| 🅱 创业指南 | `wave` | 波浪曲线 + 渐变色块过渡 | 动感、叙事感 |
| 🅲 行业白皮书 | `grid` | 数据网格 + 数据点装饰 | 严谨、数据驱动 |
| 🅳 咨询手册 | `bubble` | 对话气泡 + 连接线 | 对话、亲和力 |
| 🅴 智能教程 | `ladder` | 阶梯/层级色块 + 箭头 | 递进、成长感 |

### 封面图像生成提示词模板

```
A book cover for "{book_title}" by {author}.
Style: {visualPreset} — {visual_intent}.
Colors: primary {primary_color}, accent {accent_color}.
No text overlay. Clean, modern, professional.
Aspect ratio: 2:3 (book cover).
```

---

## §2 插图生成策略

### 2.1 插图触发条件

| 场景 | 是否生成插图 | 说明 |
|------|-------------|------|
| 章节开篇 | 可选 | 增强氛围 |
| 关键概念 | 推荐 | 辅助理解 |
| 流程步骤 | 推荐 | 可视化步骤 |
| 数据对比 | 推荐 | 表格或图表 |
| 案例叙述 | 可选 | 增强代入感 |

### 2.2 插图风格规范

| 维度 | 规范 | 说明 |
|------|------|------|
| 风格 | flat / line-art / minimalist | 与封面预设风格一致 |
| 色彩 | 使用项目主色系 | 见 `typography.md` §五 |
| 尺寸 | 宽度 100%，高度 ≤ 400px | 保持页面节奏 |
| 格式 | SVG 优先，PNG 次选 | 矢量优先 |
| 标注 | 底部居中标注图号 | `图 X-X：{描述}` |

### 2.3 插图降级策略

```
优先：宿主内建的图像生成能力（若有）
  ↓ 不可用
备选：SVG 自动生成（基于模板 + 文字描述）
  ↓ 不可用
兜底：纯文字描述 + 标记占位（`[插图：{描述}]`）
```

---

## §3 Mermaid 图表视觉规范

### 3.1 配色注入

Mermaid 代码中的颜色使用占位符，构建时替换为实际配色：

```mermaid
flowchart TD
  A[开始] --> B{判断}
  B -->|是| C[操作1]
  B -->|否| D[操作2]
  style A fill:[book.color.primary],color:#fff
  style B fill:[book.color.accent],color:#fff
```

替换规则：
- `[book.color.primary]` → `var(--c-main)` 对应值
- `[book.color.accent]` → `var(--c-gold)` 对应值
- `[book.color.muted]` → `var(--c-muted)` 对应值

### 3.2 节点标签约束

| 约束 | 说明 |
|------|------|
| 最大长度 | ≤ 15 汉字 |
| 超长处理 | 使用 `<br/>` 换行 |
| 禁止内容 | 不含特殊字符、emoji |
| 推荐格式 | 动词+名词 / 短句 |

### 3.3 图表类型选择决策树

```
需要可视化？
  ├── 展示流程/步骤 → flowchart TD
  ├── 展示交互/对话 → sequenceDiagram
  ├── 展示状态转换 → stateDiagram-v2
  ├── 展示知识结构 → mindmap
  ├── 展示时间线 → timeline
  ├── 展示排期 → gantt
  ├── 展示数据对比 → 表格
  └── 展示简单层级 → 流程块（↓├└→）
```

---

## §4 SVG 模板体系

### 4.1 SVG 封面模板

```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">
  <!-- 背景渐变 -->
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:[primary]"/>
      <stop offset="100%" style="stop-color:[primary-dark]"/>
    </linearGradient>
  </defs>
  <rect width="400" height="600" fill="url(#bg)"/>
  
  <!-- 装饰元素（按 visualPreset 注入） -->
  {decoration_elements}
  
  <!-- 书名 -->
  <text x="40" y="300" font-size="28" fill="white" font-weight="bold">
    {book_title}
  </text>
  
  <!-- 作者 -->
  <text x="40" y="340" font-size="16" fill="rgba(255,255,255,0.8)">
    {author}
  </text>
</svg>
```

### 4.2 装饰元素模板

| 预设 | SVG 装饰 | 说明 |
|------|----------|------|
| `geometric` | `<line>` + `<rect>` 网格 | 几何线条网格 |
| `wave` | `<path>` 贝塞尔曲线 | 波浪曲线 |
| `grid` | `<circle>` 数据点 + `<line>` 连线 | 数据网格 |
| `bubble` | `<ellipse>` + `<line>` | 对话气泡 |
| `ladder` | `<rect>` 阶梯色块 + `<polygon>` 箭头 | 阶梯递进 |

---

## §5 视觉密度与节奏

### 5.1 视觉密度阈值（与 templates.md §八一致）

| 级别 | 阈值 | 说明 |
|------|------|------|
| **底线** | ≤ 5000 字 ≥ 1 个视觉元素 | Mermaid / 表格 / 流程块 / 插图均算 |
| **推荐** | ≤ 3000 字 ≥ 1 个 | 信息密集型章节 |
| **上限** | ≤ 1500 字不超过 1 个 | 避免碎片化 |

### 5.2 视觉节奏建议

```
章节结构示例：
  开篇 → 插图（氛围）
  概念段 → Mermaid 图（结构）
  数据段 → 表格（对比）
  案例段 → 插图（代入）
  小结段 → 表格（归纳）
```

### 5.3 避免的视觉模式

| 禁止 | 原因 |
|------|------|
| 彩虹渐变文字 | AI味重，违反 metrics.md §6.2 |
| 过度3D效果 | 不专业，违反 metrics.md §6.2 |
| 连续3张以上插图 | 打断阅读节奏 |
| 纯装饰性图表 | 每张图须有信息增量 |
| 动画/GIF | 不适合纸质出版 |

---

## §6 构建时视觉处理

### 6.1 构建流程

```
Markdown 源码
  ↓ markdown-it 解析
HTML 中间产物
  ↓ Mermaid 渲染
  ↓ SVG/PNG 插图嵌入
  ↓ 配色注入
完整 HTML
  ↓ Playwright/Puppeteer
PDF 输出
```

### 6.2 降级策略

| 环节 | 正常 | 降级 |
|------|------|------|
| Mermaid 渲染 | Playwright 无头渲染 | 静态 SVG 替代 |
| 插图生成 | 宿主图像生成 | SVG 模板 + 占位符 |
| 封面生成 | L1/L2 | L3 纯文字封面 |
| PDF 输出 | Playwright | 浏览器打印（Ctrl+P） |

### 6.3 质量检查

| 检查项 | 工具 | 说明 |
|--------|------|------|
| Mermaid 语法 | `mmdc` 或 `mermaid-cli` | 验证图表可渲染 |
| SVG 合法性 | 浏览器直接打开 | 验证 SVG 可显示 |
| 颜色对比度 | WCAG 2.0 AA | 文字/背景对比度 ≥ 4.5:1 |
| 图表尺寸 | 目视检查 | 不超页面宽度 |
