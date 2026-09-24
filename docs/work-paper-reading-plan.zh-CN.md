# Work 读论文模式：实现计划

> 日期：2026-09-24。状态：计划，尚未改代码。
> 参考：Agentero（`/Users/zxy/codeproject/ds_project/Agentero`，commit `35e154c1`）的 Cool Papers 笔记、paper-reader 精读 skill、论文单元目录结构。
> 目标读者：在 Work（内部名 `write`）上实现该功能的人或 Agent。

---

## 0. 一句话目标

在 Work 里把一篇论文（arXiv ID/URL、papers.cool 链接、本地 PDF）变成一个"论文单元"目录。打开后左边是 PDF，右边是笔记。一键可以做两件事：

1. **获取 Cool Paper 笔记**：把 papers.cool 上 Kimi 生成的 FAQ 解析追加到 `NOTES.md`，不消耗用户的模型额度。
2. **一键解读**：用用户自己的解读提示词跑 Agent，生成一篇通俗易懂的 `<论文>-解读.md`，里面插入论文原图，重点难点配 Excalidraw 白板图（白板导出 PNG 后嵌入 md）。

---

## 1. Agentero 是怎么做的（拆解）

### 1.1 Cool Papers 笔记（核心参考）

代码位置：
- Rust：`src-tauri/src/features/paper/discovery/coolpapers/mod.rs`（672 行，包含全部解析逻辑和单测）
- 命令：`.../coolpapers/commands.rs`（`paper_coolpapers_notes`）
- 前端：`src/lib/paper/coolpapers.ts`（入队 JobCenter 任务，完成后重新载入 NOTES 编辑器）
- 按钮：`src/components/editor/toolbar/markdown-toolbar.tsx` 的 `FetchKimiNotesButton`

关键事实：

| 项 | Agentero 行为 |
|---|---|
| 数据源 | papers.cool 是服务端渲染，没有 JSON API，也不需要登录 |
| 解析接口 | `GET https://papers.cool/{arxiv\|venue}/kimi?paper={id}`，返回 HTML 和 Markdown 的混合体 |
| 搜索接口 | `GET https://papers.cool/{branch}/search?query=…`，从列表行 `<a id="title-{id}" …>{title}</a>` 里取 id 和标题 |
| 解析顺序 | ① `sourceUrl` 是 papers.cool 链接 → ② venue 形式的 catalog id（`38818@AAAI`）→ ③ arXiv id（去掉 `vN`）→ ④ 按标题在 `arxiv`、`venue` 两个分支搜索 |
| 标题匹配 | 只比较字母和数字（小写）。先找完全相等；否则要求**唯一**的长前缀匹配（≥24 字符，因为列表标题会被截断）。**不能相信排名**：站点总是返回 `Total: 1000`，查错分支也会返回看似相关的结果 |
| 找不到 | 未知 id 返回 `200` 和空 body，所以"空内容"就代表没找到 |
| 转换规则 | `<p class="faq-q">` 转成 `## Q1: …`；去掉 `<div class="faq-a">`，只剩 `</div>` 的行也去掉；解码 HTML 实体（按字符扫描，`&` 后面跟中文时不能按字节切片，他们为此修过 panic）；3 个以上连续换行压成一个空行；`$…$` 公式原样保留 |
| 去广告 | 删掉最后一问"想要进一步了解论文"（Kimi 网页版的推广）连同它的答案 |
| 写入 | 追加一个块：`**Cool Papers · Kimi 解析**` + `> 来源：[url](url)` + 正文。**按内容幂等**，不改写用户已有的内容 |
| 限流 | 全局 `Semaphore(1)` 串行（注释写的是"花的是别人的模型额度"）；超时 180s（冷门论文要现场生成，可能要 1 分钟以上）；UA 写明 `agentero/0.6 (+github url)` |
| UI | 只在 catalog 里论文的 `NOTES.md` 上显示按钮；运行时显示转圈；结果分三种提示：未找到、已存在、已追加 |

### 1.2 paper-reader 精读 skill

`templates/vault/.agents/skills/paper-reader/SKILL.md`（92 行）加上 `src/lib/paper/reader.ts`：
- 固定结构：Problem & Motivation → Core Contribution（先写 Overview，再逐个模块讲）→ Experiments（表格、消融归因）→ Limitations。
- 红线：论文里没写的细节要写 "Not explicitly specified in text"，不能编；篇幅和论文各部分的详略成正比；行内公式用 `$`，独立公式用 `$$`。
- 配图：从 TeX 源找图片路径；PDF 格式的图用 `pdftoppm` 转成 JPG。**我们不照搬这一点**：用户机器上不一定有 poppler，见 D5。
- 引用写成指向本地 PDF 的锚点（`paper.pdf#page=11`）。
- Host 负责拼 prompt：用户消息里只放事实（论文目录、输出路径、语言），怎么激活 skill 由 Host 决定。

### 1.3 论文单元目录

```text
papers/<id>/  NOTES.md  metadata.json  <id>.pdf  source/(TeX)  PAPER.md  assets/  marks/
```
`PAPER.md` 是派生正文，可以删掉重建；`source/` 和 PDF 才是原始事实来源。

### 1.4 不照搬的部分

catalog SQLite、Zotero、广场里的 papers.cool 代理浏览器、RSS、PP-DocLayoutV3 ONNX 版面分析、PDF 高亮批注持久化、全文翻译覆盖层。这些都和"读一篇论文并产出讲解"无关，放到后续再考虑（§10）。

---

## 2. Kun 现有的可复用能力（已核实）

| 能力 | 位置 | 用途 |
|---|---|---|
| Work 内的 PDF 阅读器（pdfjs、选区、页内搜索） | `src/renderer/src/components/write/WritePdfViewer.tsx` / `WritePdfPage.tsx` | 分屏左侧直接用 |
| 编辑器分组分屏 | `src/renderer/src/write/write-editor-group-actions.ts`（`splitEditorGroup` / `setSplitRatio`） | 打开论文时左 PDF、右 NOTES |
| 主进程 PDF 文本提取和页面渲染（pdfjs legacy + `@napi-rs/canvas` + OCR 兜底） | `src/main/services/write-pdf-text-service.ts`（`readWritePdfText`） | 生成 `paper.md`，按图注裁剪图片 |
| 主进程可用依赖 | `sharp`、`tar-stream`、`@napi-rs/canvas`（`package.json`） | 图片裁白边、转格式，解 arXiv e-print |
| "一键发起 Agent 回合"的先例 | `write-workspace-file-actions.ts` 里的 `generatePresentation` 和 `write-presentation.ts` 的 prompt 构造器 | 一键解读照这个写 |
| Work 白板（Excalidraw），Agent 可以自己建 | `kun/src/adapters/tool/design-excalidraw-tool.ts`：`design_open_excalidraw({boardId,title})`、`design_apply_excalidraw({boardId})` | 画重点难点 |
| 白板 PNG 导出 | `src/renderer/src/whiteboard/excalidraw-apply.ts` 的 `exportExcalidrawPngSidecar` → `.kun-whiteboards/<boardId>/excalidraw.png`（通过 `window.kunGui.saveWorkspaceImageBytes`） | 导出后嵌入 md |
| 内置 excalidraw skill | `resources/bundled-skills/excalidraw-diagram/`（`/excalidraw`，或 prompt 中出现 `excalidraw`、`手绘白板` 时触发） | 解读时一并激活 |
| skill 显式激活语法 | `kun/src/skills/skill-runtime-support.ts` 的 `explicitSkillMention`：`$<id>`、`@<id>`、`/skill:<id>` | 一键 prompt 里写 `$paper-reader $excalidraw-diagram` |
| Agent 联网工具 | `kun/src/adapters/tool/web-tool-provider.ts`：`web_fetch` / `web_search` | 不作为主路径，只在 Agent 需要补充资料时用 |

**注意，用户原提示词有两处需要修正**：
1. 写的是 "exceldraw"。它匹配不上 `excalidraw` 这个触发词，skill 不会被激活。一键 prompt 里要显式写 `$excalidraw-diagram`。
2. "用白板导出 png 放到 md 里"：现在 PNG 只会写到隐藏目录 `.kun-whiteboards/<boardId>/excalidraw.png`。直接引用这个路径不稳定，文件夹也不能整体搬走，所以需要 D7 的 `exportPath`。

---

## 3. 目标与非目标

**目标**
- G1 导入：arXiv ID 或 URL（abs/pdf/html）、papers.cool URL（arxiv/venue）、本地 PDF → `papers/<slug>/` 论文单元。
- G2 阅读：打开论文单元时自动分屏，左 PDF、右 `NOTES.md`；顶部有论文信息条。
- G3 Cool 笔记：一键追加到 `NOTES.md`，幂等，结果本地缓存。
- G4 预处理：确定性地生成 `paper.md`（按页标记的正文）和 `figures/`（原图 + `index.json`）。
- G5 一键解读：用可自定义的解读模板跑 Agent，生成 `<slug>-解读.md`，包含原图和白板图。
- G6 全部是普通文件，在 Obsidian 或 VS Code 里也能继续编辑。

**非目标（本期）**：论文库数据库、Zotero、订阅和广场、PDF 高亮批注持久化、版面分析模型、全文翻译、移动端。

---

## 4. 关键决策

- **D1 不引入数据库。** 论文单元就是普通目录加 `paper.json`。Work 文件树本身就是论文库。判定规则：某个目录下有 `paper.json` 且通过 schema 校验，它就是论文单元。
- **D2 抓取放在主进程 service，不做成 kun tool。** Cool Papers 和 arXiv 的抓取是确定性的，不花 token，可以单测和缓存，也不属于模型请求（不经过 provider/endpoint 合约）。放 `src/main/services/paper/`。以后如果需要让 Agent 调用，再包一层 kun tool（§10）。
- **D3 一键解读复用 Work 助手回合。** 和 `generatePresentation` 一样：先 flushSave，再构造 prompt，然后 `setAssistantOpen(true)` 和 `onSubmitPrompt(prompt)`。不新增 runtime 路径，也不新增子 Agent。
- **D4 解读模板 = 内置 skill + 用户模板。** 新增内置 skill `paper-reader`（规则、结构、图片和白板流程）。用户那段提示词作为**默认解读模板**，放在设置 `write.paperReading.interpretTemplate`，可以编辑、可以恢复默认。prompt 构造器只填事实：路径、文件名、语言。
- **D5 图片来源的优先级。** 预处理全部在主进程确定性完成，不让 Agent 去跑 pdftoppm 或 python。
  1. arXiv HTML（`https://arxiv.org/html/<id>`，LaTeXML）：`figure.ltx_figure` 里的 `img` 和 `figcaption`，质量最好，图注最准。
  2. arXiv e-print TeX 源：用 `\includegraphics` 加 `\caption` 对应图片。png/jpg 直接用；pdf 用 pdfjs 和 canvas 渲染成 png；eps 跳过。
  3. PDF 按图注裁剪：用主进程 pdfjs 的 textContent 找到 `Figure N` / `Fig. N` / `Table N`，做空白扫描确定图的区域，按 2x 渲染后用 sharp 裁白边。每张图带 `confidence`。
  4. 兜底：整页渲染成 `figures/pages/page-N.png`，由 Agent 按图注自己挑。
- **D6 Agent 的输入是派生文件，不是 PDF。** Kun 的 `Read` 工具不解析 PDF（已核实 `read.ts` 没有 PDF 分支）。所以 Agent 读 `paper.md`（带 `<!-- page N -->` 标记）和 `figures/index.json`，需要时再读图片（前提是模型支持视觉）。
- **D7 白板图嵌入 md：给 `design_apply_excalidraw` 增加可选参数 `exportPath`。** 参数是工作区相对路径的 `.png`，必须在工作区内，不能在 `.kun-whiteboards/` 下面。渲染端导出 sidecar 之后，再调一次 `saveWorkspaceImageBytes` 写到 `exportPath`，回执里带上实际写入的路径。这比让 Agent 用 bash `cp` 更稳（Windows 下没有 cp，而且 Agent 工具可能没有二进制复制能力）。
  - 命名（按用户要求"文件名+图片命名"）：白板 **title** = `<解读 md 文件名（不含扩展名）>-<图名>`，可以是中文，≤160 字符；**boardId** = `paper-<slug8>-<n>`，因为 boardId 只允许 `^[a-zA-Z0-9_-]{1,64}$`；**导出路径** = `<论文目录>/assets/<白板 title>.png`，文件名去掉 `\/:*?"<>|`。
- **D8 对 papers.cool 保持克制。** 只在用户点击时请求，不做自动或批量请求；全局串行；超时 180s；UA 写明 `Kun/<version> (+https://github.com/...)`；成功结果缓存到 `<论文目录>/.cache/coolpapers-kimi.md`，下次先读缓存（按钮菜单提供"强制刷新"）；追加内容带来源链接。arXiv export API 请求之间至少间隔 3s（arXiv 的使用规范）。
- **D9 本地 PDF 导入时默认复制**到 `papers/<slug>/`，不移动用户文件，`paper.json.originalPath` 记录原始位置。这样论文单元自包含，相对图片路径在搬动文件夹后仍然有效。

---

## 5. 数据模型

### 5.1 目录

```text
<workspace>/papers/<slug>/
├── paper.json                # 元数据（schema 见 5.2），论文单元的判定依据
├── <slug>.pdf                # 主 PDF
├── NOTES.md                  # 用户笔记；Cool 笔记追加在这里
├── <slug>-解读.md            # 一键解读的输出（可以有多份：-解读-2.md）
├── paper.md                  # 派生：按页标记的正文，可以删掉重建
├── figures/
│   ├── index.json            # 派生：图表清单
│   ├── fig-1.png  tab-1.png
│   └── pages/page-3.png      # 兜底整页图
├── assets/                   # 解读 md 引用的图（白板导出、Agent 挑出的原图副本）
├── source/                   # 可选：arXiv e-print 解压内容
└── .cache/coolpapers-kimi.md # Cool 笔记缓存
```

`<slug>` 的规则：arXiv 用 `<arxivId>`（点号保留，如 `1706.03762`）；venue 用 `<coolId>`，`@` 替换成 `-`；本地 PDF 用文件名 slug，重名时加 `-2`。

### 5.2 `paper.json`（`src/shared/paper/paper-types.ts`，zod 使用 `.strict()`）

```ts
type PaperUnitMetaV1 = {
  version: 1
  slug: string
  title: string
  authors: string[]
  abstract?: string
  year?: string
  venue?: string
  arxivId?: string            // 不带 vN
  doi?: string
  coolPapers?: { branch: 'arxiv' | 'venue'; id: string }
  sourceUrl?: string
  pdfUrl?: string
  pdfFile: string             // 相对论文目录，例如 "1706.03762.pdf"
  originalPath?: string       // 本地导入时的原始路径
  importedAt: string          // ISO
  preprocess?: {
    textStatus: 'none' | 'ok' | 'failed'
    figuresStatus: 'none' | 'ok' | 'partial' | 'failed'
    figuresSource?: 'arxiv-html' | 'tex' | 'pdf-caption' | 'pdf-page'
    updatedAt?: string
  }
  coolNotes?: { fetchedAt: string; matchedBy: 'sourceUrl' | 'coolId' | 'arxivId' | 'title'; url: string }
  interpretations?: Array<{ path: string; createdAt: string; threadId?: string }>
}
```

### 5.3 `figures/index.json`

```ts
type PaperFigureIndexV1 = {
  version: 1
  source: 'arxiv-html' | 'tex' | 'pdf-caption' | 'pdf-page'
  items: Array<{
    id: string                // "fig-1" / "tab-2"
    kind: 'figure' | 'table'
    label: string             // "Figure 1"
    caption: string           // 完整图注
    page?: number
    path: string              // 相对论文目录，例如 "figures/fig-1.png"
    width: number; height: number
    confidence: 'high' | 'medium' | 'low'
  }>
}
```

---

## 6. 分层模块设计

按 AGENTS.md 的顺序：先定 shared 契约，再接 preload、main，最后是 renderer。**所有新文件都要 ≤700 行**。几个现有文件已经接近上限（`kun-gui-api-surface.ts` 696 行、`preload/index.ts` 698 行、`WriteWorkspaceView.tsx` 633 行、`register-app-file-ipc-handlers.ts` 707 行），**这些文件里只允许加一两行接线代码**。

### 6.1 shared（`src/shared/paper/`）

| 文件 | 内容 |
|---|---|
| `paper-types.ts` | `PaperUnitMetaV1`、`PaperFigureIndexV1` 的 zod schema 和类型；IPC 的 payload 和 result 类型 |
| `paper-ids.ts` | `parseArxivId(raw)`（abs/pdf/html/e-print URL、`arXiv:` 前缀、裸 id、旧式 `cs.CL/0101001`，去掉 `vN`）；`parseCoolPapersUrl(raw)`（照搬 Agentero 的 `parse_coolpapers_url`，包括 `/kimi?paper=` 形式）；`isVenueCoolId(raw)`；`paperSlug(meta)` |
| `paper-ids.test.ts` | 移植 Agentero Rust 单测：`strips_arxiv_version_suffix`、`parses_cool_papers_page_and_kimi_urls`、`venue_catalog_id_accepts_cool_papers_row_ids` |
| `kun-gui-api-paper.ts` | `KunGuiPaperApi` 类型，在 `kun-gui-api-surface.ts` 里用 `& KunGuiPaperApi` 并入（仿照 `KunGuiLocalSpeechApi`） |

```ts
type KunGuiPaperApi = {
  paperImport(p: { workspaceRoot: string; input: string; localPdfPath?: string; parentDir?: string }): Promise<PaperImportResult>
  paperReadUnit(p: { workspaceRoot: string; unitDir: string }): Promise<PaperUnitReadResult>
  paperFetchCoolNotes(p: { workspaceRoot: string; unitDir: string; force?: boolean; requestId: string }): Promise<PaperCoolNotesResult>
  paperPreprocess(p: { workspaceRoot: string; unitDir: string; force?: boolean; requestId: string }): Promise<PaperPreprocessResult>
  paperCancel(p: { requestId: string }): Promise<void>
  onPaperProgress(cb: (e: PaperProgressEvent) => void): () => void
}
type PaperCoolNotesResult =
  | { ok: true; found: false }
  | { ok: true; found: true; appended: boolean; fromCache: boolean; url: string; matchedBy: string }
  | { ok: false; code: 'network' | 'timeout' | 'canceled' | 'no-notes-file' | 'invalid-unit'; message: string }
```

### 6.2 main（`src/main/services/paper/`）

| 文件 | 职责 | 大约行数 |
|---|---|---|
| `paper-http.ts` | 统一的 GET：固定 UA、`AbortSignal`、超时、**响应体大小上限**（HTML 5MB、PDF 80MB、e-print 150MB）、只允许 https、主机白名单（`papers.cool`、`arxiv.org`、`export.arxiv.org`）；从 metadata 取到的 `pdfUrl` 允许任意 https 主机，但要校验 `%PDF-` 魔数。复用主进程已有的代理设置（实现前先找现成的 fetch 或代理工具） | 150 |
| `coolpapers-client.ts` | 移植 `mod.rs`：`resolveRef`、`resolveByTitle`、`parseSearchHits`、`titleKey`、`searchQuery`、`titlesCompatible`、`decodeEntities`、`kimiHtmlToMarkdown`、`isKimiWebCtaQuestion`、`squeezeBlankLines`；模块级 Promise 队列实现 Semaphore(1)；还有 `fetchCoolPage(branch,id)`，按 `citation_*` meta 解析 venue 论文元数据（移植 `page.rs` 的 `parse_page`） | 350 |
| `coolpapers-client.test.ts` | 移植 Agentero 的全部 12 个单测（包括 `R&D返回首页` 这类中文实体用例、Q7 CTA 删除、截断标题匹配），加上 fixture HTML | 250 |
| `arxiv-client.ts` | `fetchArxivMeta(id)`（export API Atom → 标题、作者、摘要、年份、DOI，请求间隔 3s）；`downloadArxivPdf`；`fetchArxivHtmlFigures(id)`；`downloadEprint(id)`（判断是 gzip tar、单个 gz tex，还是只有 PDF） | 300 |
| `paper-unit-service.ts` | `importPaper(input)`：解析输入 → 取元数据 → 建目录 → 下载或复制 PDF → 写 `paper.json` 和 `NOTES.md` 壳（frontmatter 写 `aliases`、`arxiv`、`title`）→ 返回 unitDir；`readPaperUnit`；`updatePaperMeta`（原子写，复用 `atomic-json-file.ts`）；去重：同一 arxivId 或 coolId 已存在时直接返回已有单元 | 300 |
| `paper-notes-append.ts` | `appendMarkdownBlockIdempotent(notesPath, block)`：规范化空白后如果已经包含就跳过；只在末尾追加；**保留原文件的换行风格（CRLF/LF）和结尾换行**（记忆中 Work 富文本模式曾有丢结尾换行的 bug，这里要避免同类问题） | 80 |
| `paper-text-service.ts` | 调 `readWritePdfText` 生成 `paper.md`：`<!-- page N -->` 分隔、合并断行、识别 `References` 之后的部分并截断标注 | 150 |
| `paper-figure-service.ts` | 调度 D5 的四级来源，写 `figures/` 和 `index.json`，返回统计 | 200 |
| `paper-figure-pdf-crop.ts` | 按图注裁剪的算法（见 6.2.1） | 300 |
| `paper-figure-tex.ts` | 用 tar-stream 解 e-print，在 `.tex` 里匹配 `\begin{figure}…\includegraphics{…}…\caption{…}`，处理 `\graphicspath` 和省略扩展名的情况 | 250 |
| `paper-jobs.ts` | `requestId → AbortController` 映射，通过 `webContents.send('paper:progress', …)` 发进度 | 80 |

IPC：新建 `src/main/ipc/register-app-paper-ipc-handlers.ts`，在 `register-app-ipc-handlers.ts` 里注册（只加一行）。schema 放在新文件 `src/main/ipc/app-ipc-schemas/paper.ts`。**所有路径参数都要做工作区约束**：复用 `workspace-paths.ts` 的 `resolveOpenTargetPath` 这类函数，防止 `unitDir` 越界。

#### 6.2.1 按图注裁剪（PDF 兜底）

1. 用 `page.getTextContent()` 取 items 和 transform，按基线 y 聚合成行，得到行框。
2. 图注行：行首匹配 `/^(Figure|Fig\.?|Table|图|表)\s*(\d+)[.:：]?/i`，排除正文里的引用（引用一般在行中间，或者后面紧跟小写单词）。
3. 分栏判断：图注宽度大于页宽的 60% 算通栏，否则按图注的 x 中心判断左栏或右栏。
4. Figure：从图注顶部往上扫，直到碰到连续两行以上的正文文本块或页眉，这之间就是图的区域；Table 的图注通常在表的上方，所以往下扫。
5. 用 `page.getOperatorList()` 里 `paintImageXObject` 的变换矩阵求出位图的 bbox，和第 4 步的区域取并集。矢量图没有 XObject，只能靠空白扫描。
6. 按 scale=2 渲染（复用 `write-pdf-text-service.ts` 的 canvas 渲染），裁出区域，用 sharp `trim()` 去白边，再加 12px 边距。
7. `confidence`：区域高度在页高 10%～85% 之间，且和正文行没有交叉，记 high；只满足一项记 medium；其他记 low，同时生成整页图。

### 6.3 preload

新建 `src/preload/paper-bridge.ts`，导出 `paperBridge`（`ipcRenderer.invoke('paper:import', …)` 等，`onPaperProgress` 用现成的 `onIpcEvent`），在 `index.ts` 里用 `...paperBridge` 并入（只加一行，仿照 `sanottsSpeechBridge`）。

### 6.4 renderer

| 文件 | 职责 |
|---|---|
| `src/renderer/src/write/paper/paper-unit.ts` | `findPaperUnitDir(activePath, tree)`：从当前文件往上找有 `paper.json` 的目录，找到工作区根为止；带缓存，文件监听到 `paper.json` 变化时失效 |
| `src/renderer/src/write/paper/paper-store.ts` | 轻量 zustand slice：`unitsByDir`（meta）、`busy: { cool?: requestId; preprocess?: requestId }`、`lastNotice` |
| `src/renderer/src/write/paper/paper-interpret-prompt.ts` | `buildPaperInterpretPrompt({ unit, template, language, outputPath })`（见 §7） |
| `src/renderer/src/write/paper/paper-open-layout.ts` | `openPaperUnit(unitDir)`：左组打开 PDF，`splitEditorGroup('horizontal')`，右组打开 `NOTES.md`，分屏比例 0.55 |
| `src/renderer/src/components/write/paper/WritePaperBar.tsx` | 当前文件属于论文单元时，在编辑区顶部显示一条信息栏：标题（可折叠显示作者、年份、venue）、arXiv / papers.cool / PDF 链接，操作按钮【Cool 笔记】【一键解读】【抽取图表】【打开解读】 |
| `src/renderer/src/components/write/paper/WritePaperImportDialog.tsx` | 输入框接受 ID 或 URL，也可以选本地 PDF；导入进度（元数据 → 下载 PDF → 正文 → 图表）；导入完成后调用 `openPaperUnit` |
| `src/renderer/src/components/write/paper/CoolPapersIcon.tsx` | 小叶子图标（参考截图，自己画 SVG，不复制 Agentero 的资源） |
| `src/renderer/src/components/write/paper/use-write-paper-mode.ts` | 把以上内容接到 `WriteWorkspaceView` 的 hook，**`WriteWorkspaceView` 只加大约 10 行** |

入口：
1. Work 起始页 `WriteWorkspaceStart` 的 starter 新增一项"读论文"（图标 `GraduationCap`），打开导入对话框。
2. 工具栏：当前文件属于论文单元时，`WritePaperBar` 显示【Cool 笔记】（tooltip "获取 Cool Paper 笔记"，和截图一致）和【一键解读】。当前文件是普通 PDF 时，工具栏显示【作为论文打开】，会先导入（D9）再分屏。
3. 文件树右键 PDF：菜单项"作为论文打开"。
4. 快捷方式：在导入对话框里粘贴 arXiv 链接直接识别（这一期不做全局拦截粘贴）。

Cool 笔记按钮的状态：空闲显示图标和"笔记"；运行中显示转圈和"生成中…"（首次生成可能要 1 分钟以上，显示已等待秒数，旁边有取消按钮）；完成后提示"已追加 / 已存在 / 未找到"。如果 `NOTES.md` 正开在编辑器里并且有未保存的修改，**先 flushSave 再调 IPC**；追加完成后依靠文件监听（`write-file-watch.ts`）重新载入编辑器，避免覆盖用户正在编辑的内容。

i18n：`src/renderer/src/locales/{zh,en,ja,ru}/common/` 下新建 `paper.json` 命名空间文件（先确认 i18n 的加载方式，保持和现有拆分一致）。

### 6.5 kun

1. **新增内置 skill** `resources/bundled-skills/paper-reader/`
   - `skill.json`：`id: "paper-reader"`、`commands: ["/paper-read"]`、`promptPatterns: ["论文解读", "paper-reader", "精读论文"]`、`priority: 25`、`assets: ["references/figure-rules.md", "references/whiteboard-rules.md"]`
   - `SKILL.md`（≤120 行）：输入契约（读 `paper.md`、`figures/index.json`、`paper.json`，Cool 笔记只作参考）；输出契约（只写指定的解读 md，**不修改 PDF、NOTES.md、paper.json**）；结构要求（§7）；红线（不编造，写 "论文未明确说明"；详略和论文一致；公式格式；图片只能引用 `figures/` 或 `assets/` 下真实存在的文件）；白板流程（§7.3）。
   - 参考 Agentero skill 的写法，但用我们自己的措辞，并注明灵感来源。
   - 在 `excalidraw-diagram-skill.test.ts` 旁边加 `paper-reader-skill.test.ts`，校验清单和关键约束文本。
2. **`design_apply_excalidraw` 加 `exportPath`**（D7）
   - `kun/src/adapters/tool/design-excalidraw-tool.ts`：schema 增加 `exportPath: { type: 'string', pattern: '^[^\\0]+\\.png$' }`；校验必须是相对路径，不能含 `..`，不能以 `.kun-whiteboards/` 开头；把它带进 ops 和 extras。
   - 渲染端 `excalidraw-apply.ts`：`exportExcalidrawPngSidecar` 在写完 sidecar 后，如果有 `exportPath`，就再调一次 `saveWorkspaceImageBytes({ imageDirectory: dirname, fileName: basename })`；回执增加 `exportedPath`。
   - 注意：`excalidraw-apply.ts` 目前 233 行，改完仍然远低于上限。
   - 测试：`design-excalidraw-tool.test.ts` 覆盖参数校验；`excalidraw-apply.test.ts` 覆盖二次写入。
   - `WORK_MODE_INSTRUCTION` 里补一句 `exportPath` 的用法。这是稳定前缀，一次性修改，不放任何动态内容，不影响缓存。
3. **不新增抓取类 kun tool**（D2）。

### 6.6 设置

`src/shared/app-settings-*.ts` 的 write 切片里加 `paperReading`（`.strict()`，要带 normalizer 和迁移默认值）：

```ts
paperReading: {
  papersDir: string              // 默认 "papers"
  interpretTemplate: string      // 默认 = §7.1 的模板；空字符串表示用默认值
  outputLanguage: 'zh' | 'en' | 'auto'   // 默认 'zh'
  autoPreprocess: boolean        // 导入后自动抽正文和图表，默认 true
  coolNotesEnabled: boolean      // 默认 true，可以关闭（公司内网之类的场景）
}
```
设置页：Work 设置下新增"读论文"小节，放模板编辑框（支持"恢复默认"）、语言、目录。

---

## 7. 一键解读：prompt 与流程

### 7.1 默认解读模板（在用户原话基础上整理，存进设置，可以编辑）

```markdown
请帮我从以下几个方面观察这篇论文：
## 论文大概
## 论文提出的问题
## 论文的解决办法
## 实验
## 总结

然后创建一个 Markdown 文件，详细讲解这篇论文，写成一篇通俗易懂的讲解文章。
- 把论文里的关键图片抽出来放进文章，配合讲解（优先使用 figures/ 下已经抽好的图）。
- 对重点、难点、不容易理解的地方，用 Excalidraw 白板画图辅助讲解：
  每张图自己创建一个白板，白板名字用"文件名-图片名"；画好后用白板导出 PNG，放进文章对应的位置。
```

### 7.2 Host 拼出的 prompt（`buildPaperInterpretPrompt`）

模板之外，Host 只补充**事实和契约**，不重复 skill 里的规则：

```text
$paper-reader $excalidraw-diagram
论文目录：papers/1706.03762
正文：papers/1706.03762/paper.md（按页标记）；图表清单：papers/1706.03762/figures/index.json
元数据：papers/1706.03762/paper.json；Cool 笔记（如有，仅供参考）：papers/1706.03762/NOTES.md
输出文件（只写这个文件）：papers/1706.03762/1706.03762-解读.md
白板命名：title = "1706.03762-解读-<图名>"，boardId = "paper-1706037-<序号>"，
          导出：design_apply_excalidraw 的 exportPath = "papers/1706.03762/assets/<title>.png"
语言：简体中文；术语保持英文。
---
<用户模板>
```

- 输出文件已存在时，自动改名为 `-解读-2.md`，不覆盖旧文件。
- 预处理还没完成时：先在 UI 上跑 `paperPreprocess`，并显示"正在准备论文正文与图表…"，完成后再提交 prompt；预处理失败时照常提交，并在 prompt 里注明"图表抽取失败，只能引用整页图或不配图"。
- 当前模型不支持视觉时（从 provider 模型能力标签判断），prompt 里加一句"无法查看图片，请依据 index.json 的 caption 选图，跳过 confidence=low 的图"。

### 7.3 Agent 端流程（写在 `SKILL.md` 里）

1. 读 `paper.json`、`figures/index.json`，按需分段读 `paper.md`（长论文不要一次全读，先读摘要、引言、方法、实验）。
2. 列出大纲：五个部分，以及 2～4 个"重点难点"，每个难点对应一张白板图。
3. 写 md 正文。插入原图用 `![Figure 1：图注摘要](figures/fig-1.png)`，路径相对于解读 md 所在目录。
4. 每个难点：`design_open_excalidraw({boardId, title})` → 写 `.kun-whiteboards/<boardId>/excalidraw.json` → `design_apply_excalidraw({boardId, exportPath})` → 等渲染回执 → 能看图时读 PNG 自检 → 在 md 里插入 `![<图名>](assets/<title>.png)`。
5. 结尾写"重点难点速查"和"一句话总结"。不加 Sources 块；引用写成 `[p.5](1706.03762.pdf#page=5)`。
6. 完成后简短汇报：文件路径、用了几张原图、几张白板图、有哪些局限。

### 7.4 完成后 UI

Host 在回合结束时检查输出文件是否存在：存在就把它写进 `paper.json.interpretations`，并在右侧编辑组打开，显示成新标签页，NOTES 仍保留。解读 md 里的图片路径由 Work 现有的图片渲染解析（`markdown-image.ts`，要确认相对路径的解析基准是 md 所在目录）。

---

## 8. 分阶段实施

每个阶段都能单独合入，按 AGENTS.md 走 `codex/` 分支、目标分支 `develop`、使用 Angular 风格的提交信息。

### P0 Spike（0.5 天，不合入）
- 实测：`papers.cool/arxiv/kimi?paper=1706.03762`（**2026-09-24 已实测可用**，返回 `faq-q`/`faq-a` 结构，和 Agentero 的解析一致）；venue 论文 `38818@AAAI`；一个 papers.cool 上没有的 id（确认是空 body）。
- 实测 arXiv HTML 的 figure DOM（`ltx_figure`、`img src` 的相对基准、`ltx_tag_figure`）；找 2 篇没有 HTML 版本的旧论文。
- 实测 e-print 的三种形态：tar.gz、单个 .gz、PDF-only。
- 在 3 篇论文上验证 §6.2.1 的裁剪（单栏、双栏、带大量矢量图），记录命中率。
- 确认 `saveWorkspaceImageBytes` 可以写到任意工作区子目录，文件名可以是中文。
- 产出：fixture 文件放到 `src/main/services/paper/__fixtures__/`（HTML 只保留必要片段，注意体积和版权，不存论文正文全文）。

### P1 论文单元、导入、分屏（2 天）
- shared：`paper-types.ts`、`paper-ids.ts` 及测试。
- main：`paper-http.ts`、`arxiv-client.ts`（只做元数据和 PDF）、`coolpapers-client.ts` 中的 `fetchCoolPage`、`paper-unit-service.ts`、IPC、preload。
- renderer：导入对话框、`openPaperUnit` 分屏、`WritePaperBar`（先只显示信息和链接）、起始页入口、"作为论文打开"。
- 验收：输入 `1706.03762`、`https://arxiv.org/abs/1706.03762v7`、`https://papers.cool/venue/38818@AAAI`、本地 PDF，都能得到正确的单元目录并分屏打开；重复导入会命中已有单元。

### P2 Cool Paper 笔记（1.5 天，这一阶段就能单独发布）
- main：完整的 `coolpapers-client.ts`（解析顺序、标题匹配、kimi 转换、串行、缓存）、`paper-notes-append.ts`、取消。
- renderer：按钮、进度、取消、三种结果提示、flushSave 后再调用、追加后重新载入。
- 验收：arXiv 论文可以追加；再点提示"已在笔记中"；强制刷新会重新请求；venue 论文可以追加；随便填的标题提示"未找到"；断网时给出可以理解的错误；CRLF 的 NOTES 追加后仍是 CRLF，结尾换行保留。

### P3 正文与图表预处理（3 天）
- `paper-text-service.ts`、`paper-figure-service.ts`、`paper-figure-tex.ts`、`paper-figure-pdf-crop.ts`。
- 导入后自动触发（受 `autoPreprocess` 控制）；信息栏里的【抽取图表】可以手动重跑。
- 验收：arXiv 新论文走 HTML 来源，Figure 1 到 N 齐全，图注正确；只有 PDF 的双栏论文，high+medium 占比 ≥70%（P0 实测后再调这个阈值）；扫描版 PDF 走 OCR 文本，只生成整页图。

### P4 一键解读（2.5 天）
- skill `paper-reader`、`exportPath` 契约（kun tool、渲染端、`WORK_MODE_INSTRUCTION`）、`buildPaperInterpretPrompt`、设置切片和设置 UI、回合结束后打开输出文件。
- 验收：对 1706.03762 一键解读，生成 `-解读.md`，五个部分齐全，至少 2 张原图、至少 2 张白板图；白板名称符合"文件名-图片名"；PNG 在 `assets/` 下且 md 能正常渲染；NOTES.md 和 PDF 没有被改动；换成用户自定义模板后行为跟着变。

### P5 打磨（1.5 天）
- 侧栏"论文"视图：列出工作区里所有论文单元（扫描 `papers/*/paper.json`），显示标题、年份，以及有没有解读、有没有 Cool 笔记。
- 错误态、空态、快捷键（比如 `⌘⇧P` 打开导入对话框，要先确认没有冲突）。
- 文档：`docs/work-paper-reading.zh-CN.md` 和 `.en.md` 两份用户文档。

总计约 11 天（1 人），P2 完成后就可以先发一版。

---

## 9. 测试与验证

**单元测试（vitest）**
- `paper-ids.test.ts`：各种 ID 和 URL 形态。
- `coolpapers-client.test.ts`：移植 Agentero 的 12 个用例，另外加三个：fixture 整页转换的快照、串行队列（两个并发请求按顺序执行）、缓存命中不发请求。
- `arxiv-client.test.ts`：Atom 解析、HTML figure 解析（fixture）。
- `paper-figure-tex.test.ts`：`\graphicspath`、省略扩展名、subfigure。
- `paper-figure-pdf-crop.test.ts`：纯函数部分（行聚合、图注识别、分栏判断、区域计算）用合成的 textContent 测；渲染部分用一个很小的 fixture PDF（自己生成，不用论文原文件）。
- `paper-notes-append.test.ts`：幂等、CRLF、结尾换行、空文件。
- `paper-interpret-prompt.test.ts`：显式 skill 语法、路径、改名、没有视觉能力时的分支、自定义模板。
- `design-excalidraw-tool.test.ts`：`exportPath` 校验（`..`、绝对路径、`.kun-whiteboards/`、非 png 都要拒绝）。
- `paper-reader-skill.test.ts`：清单和关键约束。

**真实网络测试**：`KUN_PAPER_LIVE=1 npx vitest run src/main/services/paper/*.live.test.ts`，默认跳过，CI 不跑。

**命令**：`npm run typecheck`、`npm run test`、`npm run build:kun`（改了 kun）、`npm run build`、`npm run lint`、`npm run check:file-lines`。遇到失败先区分是不是 develop 上已有的红测（见记忆 develop-pre-existing-red-tests）。

**手动端到端**（`npm run dev`，用 Browser 或 Electron 实际点一遍）：导入 → 分屏 → Cool 笔记 → 抽图 → 一键解读 → 打开解读 → 检查图片渲染和白板 PNG → 用 Obsidian 打开同一目录，确认兼容。

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| papers.cool 改版，HTML 结构变化 | 解析容错，任何一步匹配不上都当"未找到"，不抛错；fixture 测试能尽早发现；日志只记状态码和 body 摘要，不记全文 |
| 占用 papers.cool 的额度、违反使用规范 | 只在用户点击时请求；串行；本地缓存；UA 标明身份；保留来源链接；提供开关（`coolNotesEnabled`）。发布前通读 papers.cool 的 About 和 FAQ，确认没有禁止程序化访问；如果禁止，这个功能改为"在浏览器打开 kimi 页面" |
| 首次生成慢（超过 1 分钟） | 超时 180s，显示已等待时间，可以取消；取消只停本地等待（上游已经开始生成的，下次请求会更快） |
| arXiv 限流 | export API 请求间隔 ≥3s；PDF 和 e-print 各一次请求；失败可以重试，并提示稍后再试 |
| 图注裁剪不准 | 按 confidence 分级，保留整页兜底；有视觉能力的模型会自检；解读时不引用 low 的图；信息栏支持手动重跑 |
| 模型没有视觉能力（比如 DeepSeek 纯文本模型） | 图片选择改为依据图注；白板自检改为只检查 JSON 结构（excalidraw skill 已有规则）；prompt 里写明这一点 |
| 解读回合很长、token 多 | skill 规定分段读 `paper.md`；`paper.md` 截掉 References；图表只给 `index.json`；估算后在 UI 上提示"长论文预计耗时" |
| `exportPath` 被用来写任意文件 | 工具层和渲染层都校验：必须是工作区相对路径、`.png` 结尾、没有 `..`、不在隐藏系统目录下；只允许写 PNG 字节 |
| 文件行数超出 700 行的门禁 | 所有新逻辑放新文件；接近上限的文件只加一两行接线（§6 开头的清单） |
| 文件名含中文或特殊字符 | boardId 只用 ASCII slug；导出文件名做字符清洗；Windows 下测试路径长度 |
| 解读 md 的图片相对路径在 Work 里解析错误 | P0 确认 `markdown-image.ts` 以 md 所在目录为基准；导出 docx/pdf 时（`write-export-service.ts`）也要验证图片能带上 |
| 许可证 | Agentero 是 MIT 协议。移植逻辑可以，但要在 `coolpapers-client.ts` 头部注释注明来源；不复制图标和文档原文 |

---

## 11. 与 Agentero 的差异一览

| 维度 | Agentero | Kun Work（本计划） |
|---|---|---|
| 论文库 | SQLite catalog 加 sidecar | 只有 `paper.json` sidecar，文件树就是论文库 |
| Cool 笔记实现 | Rust、JobCenter 任务 | TS 主进程 service，requestId 可取消，本地缓存 |
| 按钮出现条件 | catalog 里论文的 NOTES.md | 论文单元内的任何文件（信息栏）；普通 PDF 显示"作为论文打开" |
| 精读 | ACP 外部 Agent 跑 skill，写进 NOTES.md | Kun 内置 Agent 在 Work 助手回合里执行，输出独立的解读 md，NOTES 不动 |
| 配图 | Agent 从 TeX 找图，用 pdftoppm 转换 | 主进程预抽图（HTML → TeX → PDF 裁剪 → 整页），Agent 只负责挑图 |
| 画图 | 无（只有 Excalidraw 编辑能力） | Work 白板，加 `exportPath` 自动嵌入 |
| 提示词 | 内置 skill，写死 | 内置 skill 负责规则，用户模板负责内容偏好，可以编辑 |

---

## 12. 后续可选（不在本期范围）

- 把 `paper_fetch_cool_notes`、`paper_import` 包成 kun tool，这样在 Code 或聊天里也能说"帮我导入这篇论文"。
- 划词提问、翻译写入 `marks/`；PDF 高亮持久化。
- 参考文献解析，一键导入引用的论文。
- papers.cool 的 arXiv 每日列表浏览（Agentero 的广场代理），以及"根据我的论文库推荐"。
- 批量解读（排队、限速，并提示成本）。
