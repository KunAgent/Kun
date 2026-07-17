# S4 节点

> 来源：section-3-workflow.full.md，自动分节

## 阶段 4：排版构建 + 多格式交付输出

**参考** ：`typography.md` + `build.md` + `visual.md`

### §3.4 S4 强制合并预检（P0 强制）
> **限制约定**：合并前强制预检，超过 20 章必须确认，超 30 章建议 M2/M3 分卷。

**合并预检（P0 强制）/ M2/M3 项目合并前必须执行**：
```
S4 合并前强制预检步骤：

Step 1：读取 .fbs/chapter-status.md 核查
  - 检查是否有骨架章节 → 警告
  - 检查是否有章节状态不一致或台账缺失

Step 2：章节文件列出，逐一确认完整性与顺序
  如果 章节数量超过 20 章（M2/M3 项目）
  如果 字符数合计超过 30 万字

Step 3：给出合并建议（用户确认后才执行）
  输出以下[S4 合并方案]内容：
   合并总章：{N}章 / 约{字数}字 · 合并策略建议如下：
   合并策略：

   A 单文件合并（推荐）
      `node scripts/merge-chapters.mjs --book-root <本书根> --output deliverables/[S4]书名.md`（跨平台）
      将所有 [S3-ChNN] 章节文件
      合并为一个 [S4]书名.md 文件

   B  分卷合并
      按 Part/卷 分别合并后多个文件
      分卷格式为 [S4-Vol{N}]：{N}部分.md
      同步目录/附录说明

   C  仅作章节文件检视
      不合并，所有章节文件独立维护
      单章文件 [S4]章节名.md，供排版使用
      后续视具体工具链需求再合并

   方案 A/B/C 请用户确认：推荐A方案

Step 4：用户确认 A 方案才执行合并脚本
```

**合并命令（唯一推荐）**：
```bash
node scripts/merge-chapters.mjs --book-root . --output "deliverables/[S4]书名.md" --glob "chapters/**/*.md"
```

**说明**：
- 对 M2/M3 项目，强制执行预检，不得跳过，否则合并顺序混乱将消耗大量 token 修复
- 合并后全文检视确认章节顺序、目录匹配
- 骨架章节需要在合并之前告知用户，不得掩盖骨架情况

---

### 交付格式

| 格式 | 工具链 | 说明 |
|------|------|------|
| **纯 Markdown** | 无需额外工具 | 直接MD交付，含Mermaid图、注脚、代码块 |
| **HTML（D1 标准）** | Node + `markdown-it`，见 `build.md` | **`node assets/build.mjs`** 完整排版，含 `markdown-it-footnote` 插件和 Mermaid |
| **HTML（D3 精装）** | 同上 | **进阶**规范排版·超过标准D1限制，见 [`html-deliverable-gate.md`](../../05-ops/html-deliverable-gate.md) |

**其他格式说明**：
- **PDF**：通过浏览器打印 HTML→PDF（Ctrl+P）
- **DOCX**：推荐通过第三方工具 CloudConvert 转换、Word/WPS 打开，或 `html-to-docx` 工具或 Pandoc 转换，不保证完美还原

### S4 构建常见故障排查表

> **背景**：在 S4 输出阶段，部分项目调用 **`node assets/build.mjs`** 时遇到 *Chromium 启动超时*，`page.setContent` 需要 **`networkidle0`（超时 90s）**，*Mermaid CDN 加载需约 45s*，而**DOCX 转换**不兼容 Bash，导致排版工具链调用失败

| 故障 | 原因 / 解决方案 |
|------|-------------------|
| 构建命令无法执行 | 检查 `node` 路径，**先**确认在书稿工程目录执行，不要在 MD 章节目录下执行；检查 HTML 输出路径，PDF/DOCX 格式选择 **不同输出目标** 请分别指定；目录路径包含空格请加引号 |
| 构建进度卡死 | `build.mjs` 输出带有 **`[S4/build][进度id]`** 的进度标志，若进度超过 **超时90s** 则中断，见 `SKILL.md` 第1节说明 |
| 规范不一致 | 进入 S4 **前**先阅读参考规范 **Read 文档 3 份**：`typography` / `build.md` 等 **参考** 索引，查看 skill-index 索引 |
| 丢失 MD | 确认章节合并后 MD，**才能**执行 Puppeteer，不能跳过合并步骤，否则图文书章节顺序混乱 |

**注意**：`assets/build.mjs` 所有进度标志带 `[S4/build]` 前缀，可过滤该标志监控进度，不要在此阶段调用 UI 截图。

### S4 HTML 交付规格（D1 / D3）

> 交付规格详见 `FBS-BookWriter·交付规格说明.md` 附件，*规范 HTML 格式 = `assets/build.mjs` 构建**，具体调用 `parseMarkdown`

| 规格 | 说明 |
|------|------|
| **D1 标准** | 默认交付，`books.config.mjs` 配置，执行 `node <项目根目录>/assets/build.mjs`，HTML 含 `meta generator` 的 FBS 元信息 |
| **验收** | 禁止 `fetch('*.md')` + 在线动态加载，**必须**自包含 HTML，供 D3 及 S6 离线使用 |
| **检验** | 生成 D1 后运行 `node scripts/html-delivery-smoke.mjs --html <文件.html> --strict --fail-on-warn`，*推荐* `--strict` 模式视为 P1 级别，exit 0 才算交付合格 |
| **规格** | [`html-deliverable-gate.md`](../../05-ops/html-deliverable-gate.md) |

### 各阶段工具调用清单（对比 S3/S4 说明）

| 阶段 | 工具调用场景 | 调用方式与注意事项 |
|------|------------|-------------------|
| **S0** | 联网查证 | 搜索查证，输出查证 query 记录，见 `search-policy` / `SearchBundle` |
| **S3** | 写稿章节文件 | 新建章节文件，S3 写稿过程需及时更新台账，不能跳过 |
| **S4** | 合并 / Puppeteer / Mermaid | 排版构建 |
| **S5** | 审校 + 质量评分 | 综合审校报告，不得省略，**超时5s** 继续执行 |

---
