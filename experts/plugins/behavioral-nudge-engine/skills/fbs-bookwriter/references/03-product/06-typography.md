# 中文排版规范

> 阶段4/5加载 | 排版规则与设计时参考
> 排版规则分为两个宗旨：违反基线即违规（禁改空间为0）；设计空间（有范围可调）；参考规则可参考

---

## 一、违反基线即违规（零容错）

**这些规则如果违反，就是排版错误，不存在"优化"为违规。**

| 规则 | CSS | 禁忌 |
|------|-----|------|
| 正文首行缩进2em | `p { text-indent: 2em; }` | `h1+p{text-indent:0}`（英式惯例） |
| 正文两端对齐 | `p { text-align: justify; }` | 无 |
| h1 左对齐 | `h1 { text-align: left; }` | 居中（英式惯例） |
| h1 无字间距 | `h1 { letter-spacing: 0; }` | `letter-spacing:6px`（英式惯例） |
| h1 主色下边框 | `border-bottom: 3px solid var(--c-main);` | 上边框 |
| h1 强制分页 | `h1 { page-break-before: always; }` | 无 |
| h2 主色左边框 | `border-left: 4px solid var(--c-main);` | 无 |
| 引用块缩进 | `text-align: justify; text-indent: 2em;` | 居中+装饰边线（英式 pull-quote） |
| 引用块金色左边框 | `border-left: 3px solid var(--c-gold);` | `border-image:gradient` |
| 代码块缩进 | `text-align: justify; text-indent: 2em;` | 居中+斜体（英式惯例） |
| A4 页面 | `@page { size: A4; margin: 25mm 20mm; }` | 无 |

> **注意**：很多"typography best practices"得到的结论默认是英文的。中文有自己的排版传统，AI 生成内容容易误用英式默认值。

---

## 二、设计空间（有范围可调，非零即违规）

### 2.1 行高

| 语境 | 推荐值 | 允许范围 | 说明 |
|------|--------|----------|------|
| 正文 | 1.8 | 1.6–2.0 | 中文行高需要比英文大 |
| 标题 | 1.4 | 1.3–1.6 | 标题行高可紧凑 |
| 引用块 | 1.7 | 1.5–1.9 | 引用块略低于正文行高 |
| 表格 | 1.5 | 1.4–1.6 | 表格内行高紧凑 |
| 代码块 | 1.6 | 1.4–1.8 | 代码块行高适中 |

### 2.2 字号

| 元素 | 推荐值 | 允许范围 | 说明 |
|------|--------|----------|------|
| 正文 | 16px | 15–18px | 中文正文不宜小于15px |
| h1 | 28px | 24–32px | 章标题 |
| h2 | 22px | 20–24px | 节标题 |
| h3 | 18px | 16–20px | 小节标题 |
| 引用块 | 15px | 14–16px | 引用略小于正文 |
| 表格 | 14px | 13–15px | 表格字号紧凑 |
| 脚注 | 12px | 11–13px | 脚注最小 |

### 2.3 间距

| 元素 | 推荐值 | 允许范围 | 说明 |
|------|--------|----------|------|
| 段间距 | 1em | 0.8–1.2em | 正文段落间距 |
| h1 上间距 | 2em | 1.5–2.5em | 章标题上方间距 |
| h1 下间距 | 1em | 0.8–1.2em | 章标题下方间距 |
| h2 上间距 | 1.5em | 1.0–2.0em | 节标题上方间距 |
| h2 下间距 | 0.8em | 0.5–1.0em | 节标题下方间距 |
| 表格上下间距 | 1em | 0.8–1.5em | 表格前后间距 |

---

## 三、中文标点规则

### 3.1 标点占位

- 中文标点占全角位置，不得使用半角标点
- 中英文混排时，中文字符与英文字符之间不加空格
- 数字与中文之间不加空格

### 3.2 引号用法

| 场景 | 正确 | 错误 |
|------|------|------|
| 中文引用 | 「」或"" | ""（半角） |
| 中文嵌套 | 「『』」 | 「「」」 |
| 强调 | 「关键词」 | *关键词*（仅限 Markdown 源码） |

### 3.3 破折号

- 中文破折号用「——」（两个 em dash）
- 不得使用「--」（两个 hyphen）或「—」（单个 em dash）
- 破折号前后不加空格

### 3.4 省略号

- 中文省略号用「……」（六个点）
- 不得使用「...」（三个半角点）或「…」（三个 Unicode 点）

---

## 四、页面布局

### 4.1 A4 页面参数

```css
@page {
  size: A4;
  margin: 25mm 20mm;

  @bottom-center {
    content: counter(page);
    font-size: 10px;
    color: var(--c-muted);
  }
}
```

### 4.2 分页规则

| 元素 | 分页行为 | 说明 |
|------|----------|------|
| h1 | `page-break-before: always` | 每章强制分页 |
| h2 | `page-break-after: avoid` | 避免节标题与内容分离 |
| 表格 | `page-break-inside: avoid` | 避免表格跨页 |
| 代码块 | `page-break-inside: avoid` | 避免代码块跨页 |
| 图片 | `page-break-inside: avoid` | 避免图片跨页 |

### 4.3 孤行/寡行控制

```css
p {
  orphans: 2;  /* 页底至少保留2行 */
  widows: 2;   /* 页首至少保留2行 */
}
```

---

## 五、颜色系统

### 5.1 主色与功能色

```css
:root {
  --c-main: #2C5F7C;      /* 主色：深蓝 */
  --c-gold: #C4973B;      /* 强调色：金色 */
  --c-muted: #666666;     /* 次要文字 */
  --c-bg: #FFFFFF;        /* 背景 */
  --c-border: #E0E0E0;    /* 边框 */
  --c-code-bg: #F5F5F5;   /* 代码块背景 */
  --c-quote-bg: #FAFAFA;  /* 引用块背景 */
}
```

### 5.2 颜色使用规则

| 规则 | 说明 |
|------|------|
| 正文黑色 | 正文使用 `#333333`，不得使用纯黑 `#000000` |
| 标题主色 | h1/h2 使用 `--c-main` |
| 强调金色 | 引用块边框、重要标注使用 `--c-gold` |
| 链接色 | 使用 `--c-main`，hover 状态加深 |
| 禁止彩虹渐变 | 文字颜色不得使用彩虹渐变效果（见 metrics.md §6.2） |

---

## 六、表格排版

### 6.1 表格样式

```css
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 14px;
}

th {
  background: var(--c-main);
  color: white;
  padding: 8px 12px;
  text-align: left;
}

td {
  border-bottom: 1px solid var(--c-border);
  padding: 8px 12px;
}

tr:nth-child(even) {
  background: var(--c-quote-bg);
}
```

### 6.2 宽表格处理

- 超过 4 列的表格考虑缩小字号（13px）
- 超过 6 列的表格考虑拆分为多个表
- 单元格内容过长时使用 `white-space: nowrap` + 横向滚动

---

## 七、代码块排版

### 7.1 代码块样式

```css
pre {
  background: var(--c-code-bg);
  border-left: 3px solid var(--c-main);
  padding: 1em;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
}

code {
  font-family: 'Fira Code', 'Source Code Pro', monospace;
  background: var(--c-code-bg);
  padding: 0.1em 0.3em;
  border-radius: 3px;
}
```

### 7.2 行内代码 vs 代码块

| 场景 | 使用 | 说明 |
|------|------|------|
| 命令名、函数名 | 行内 `code` | 如 `npm install` |
| 配置片段 | 代码块 | 多行代码 |
| 输出样例 | 代码块 | 带格式的内容 |
| 文件路径 | 行内 `code` | 如 `SKILL.md` |

---

## 八、特殊元素

### 8.1 Mermaid 图表

- Mermaid 代码块使用标准 ````markdown` 围栏
- 图表宽度不超过页面宽度
- 节点标签 ≤ 15 汉字（见 `visual.md` §3）
- 配色使用 CSS 变量，构建时替换

### 8.2 脚注

- 使用 Markdown 脚注语法 `[^1]`
- 脚注内容放在章节末尾
- 脚注编号按章节独立计数

### 8.3 交叉引用

- 章节引用格式：`第 N 章` 或 `§X.X`
- 图表引用格式：`图 X-X`
- 表格引用格式：`表 X-X`

---

## 九、打印优化

### 9.1 打印样式

```css
@media print {
  body {
    font-size: 12pt;
    line-height: 1.8;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  pre {
    border: 1px solid #ccc;
    page-break-inside: avoid;
  }
}
```

### 9.2 打印检查清单

- [ ] 所有颜色在灰度打印下可辨识
- [ ] 链接在打印时显示 URL
- [ ] 表格不跨页断裂
- [ ] 代码块不跨页断裂
- [ ] 页码正确显示
